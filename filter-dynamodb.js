const {
  co,
  clone,
  extend,
  toObject,
  debug,
  getIndexes,
  resultsToJson,
  sortResults,
  getQueryInfo,
  promisify,
  deepEqual,
  getModelPrimaryKeys
} = require('./utils')

const OPERATORS = require('./operators')
const { getComparators } = require('./comparators')
const { filterResults } = require('./filter-memory')
const { defaultOrderBy, defaultLimit } = require('./constants')

function FilterOp (opts) {
  const {
    table,
    models,
    model,
    filter={},
    orderBy=defaultOrderBy,
    limit=defaultLimit,
    after,
    consistentRead
  } = opts

  extend(this, opts)
  this.filter = clone(filter)
  this.limit = limit
  this.orderBy = orderBy

  extend(this, getQueryInfo(this))
  this._configureBuilder()
  this._addConditions()
}

FilterOp.prototype.exec = co(function* () {
  let result
  const {
    builder,
    models,
    model,
    orderBy,
    fullScanRequired,
    filter,
    after,
    limit,
    itemToPosition,
    queryProp,
    index
  } = this

  if (fullScanRequired) {
    result = yield exec(builder)
    yield this._postProcessResult(result)
    result.Items = filterResults({
      models,
      model,
      filter,
      results: result.Items
    })
  } else {
    result = yield this.collectInBatches()
  }

  let items = result.Items
  // if (orderBy) {
  // sort first
  // when fullScanRequired === true, ExclusiveStartKey is meaningless
  // because we first need to scan the whole table before we can sort
  items = sortResults({
    results: items,
    orderBy
  })
  // }

  if (after) {
    // if we're running a scan
    // we need to do pagination in memory
    const idx = items.findIndex(item => {
      for (let prop in after) {
        if (!deepEqual(after[prop], item[prop])) {
          return false
        }
      }

      return true
    })

    if (idx !== -1) {
      items = items.slice(idx + 1)
    }
  }

  let startPosition
  if (items.length) {
    startPosition = this.itemToPosition(items[0])
  } else {
    startPosition = after && this.itemToPosition(after)
  }

  let endPosition
  if (!orderBy || orderBy.property === queryProp) {
    if (items.length <= limit) {
      endPosition = getStartKey(builder)
    }
  }

  if (!endPosition) {
    const length = Math.min(limit, items.length)
    endPosition = itemToPosition(items[length - 1])
  }

  if (items.length > limit) {
    items = items.slice(0, limit)
  }

  return {
    items,
    startPosition,
    endPosition,
    index,
    itemToPosition
  }
})

const exec = co(function* (builder, method='exec') {
  try {
    return yield promisify(builder[method].bind(builder))()
  } catch (err) {
    if (err.code === 'ResourceNotFoundException') {
      return {
        Count: 0,
        ScannedCount: 0,
        Items: []
      }
    }

    throw err
  }
})

const getStartKey = builder => {
  return builder.request.ExclusiveStartKey
}

FilterOp.prototype.collectInBatches = co(function* () {
  const { models, model, table, filter, limit, index, builder } = this

  // limit how many items dynamodb iterates over before filtering
  // this is different from the sql-like notion of limit

  let batchLimit = limit
  if (!isEmpty(filter)) {
    batchLimit = limit * 2
    if (batchLimit < 10) batchLimit = 10
  }

  builder.limit(batchLimit)

  const result = yield exec(builder)
  yield this._postProcessResult(result)
  result.Items = filterResults({
    models,
    model,
    filter,
    results: resultsToJson(result.Items)
  })

  const getNextBatch = exec.bind(null, builder, 'continue')
  while (result.Count < limit && builder.canContinue()) {
    let batch = yield getNextBatch()
    if (batch.Count) {
      result.Count += batch.Count
      result.ScannedCount += batch.ScannedCount
      result.Items = result.Items.concat(filterResults({
        models,
        model,
        filter,
        results: resultsToJson(batch.Items)
      }))
    }

    if (!batch.LastEvaluatedKey) break
  }

  return result
})

FilterOp.prototype._postProcessResult = co(function* (result) {
  const { table, index } = this
  if (index && index.projection.ProjectionType !== 'ALL') {
    debug('inflating due to use of index')
    result.Items = yield result.Items.map(table.inflate)
  }
})

FilterOp.prototype._addConditions = function () {
  const { model, filter, after, opType, builder, fullScanRequired } = this
  const primaryKeys = getModelPrimaryKeys(model)
  const conditionBuilders = {
    where: builder.where && builder.where.bind(builder),
    filter: builder.filter && builder.filter.bind(builder)
  }

  if (after) {
    if (!fullScanRequired) {
      builder.startKey(after)
    }
  }

  const comparators = getComparators(opType)
  for (let op in filter) {
    let setCondition = comparators[op]
    if (!setCondition) {
      debug(`comparator ${op} for op type ${opType} doesn't exist or is not implemented (yet)`)
      continue
    }

    let conditions = filter[op]
    for (let prop in conditions) {
      if (prop in OPERATORS) {
        debug('nested operators not support (yet)')
        continue
      }

      let conditionMethod = !builder.filter || prop === primaryKeys.rangeKey
        ? 'where'
        : 'filter'

      let conditionBuilder = conditionBuilders[conditionMethod]
      setCondition({
        where: conditionBuilder,
        key: prop,
        value: conditions[prop]
      })
    }
  }

  return builder
}

FilterOp.prototype._configureBuilder = function _configureBuilder () {
  const { opType, filter, orderBy, table, queryProp, index, consistentRead } = this
  const { EQ } = filter
  const createBuilder = table[opType]
  let builder
  let fullScanRequired = true
  // if (!orderBy) {
  //   orderBy = {
  //     property: queryProp || '_time'
  //   }
  // }

  if (opType === 'query') {
  //   // supported key condition operators:
  //   // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions

    builder = createBuilder(EQ[queryProp])
    delete EQ[queryProp]
    if (index) {
      builder.usingIndex(index.name)
    }

    if (orderBy.property === queryProp) {
      fullScanRequired = false
      if (orderBy.desc) {
        builder.descending()
      } else {
        builder.ascending()
      }
    }
  } else {
    // fullScanRequired = !!orderBy
    builder = createBuilder()
  }

  if (fullScanRequired) {
    debug('full scan required')
    builder.loadAll()
  }

  if (consistentRead) {
    builder.consistentRead()
  }

  this.builder = builder
  this.fullScanRequired = fullScanRequired
}

// function usesNonPrimaryKeys ({ model, filter }) {
//   return props.some(prop => !indexed[prop])
// }

const isEmpty = obj => {
  return !obj || Object.keys(obj).length === 0
}

module.exports = opts => new FilterOp(opts).exec()

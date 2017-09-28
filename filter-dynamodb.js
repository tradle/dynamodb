const traverse = require('traverse')
const {
  co,
  clone,
  pick,
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
const { filterResults } = require('./filter-memory')
const { defaultOrderBy } = require('./constants')
const DEFAULT_LIMIT = 50

const CREATE_EQUALITY_CHECK = method => {
  const checkStrict = ({ where, key, value }) => {
    return where(key)[method](value)
  }

  return function addEqualityCheck ({ where, key, value }) {
    if (method === 'ne' || (value == null || typeof value !== 'object')) {
      return checkStrict({ where, key, value })
    }

    // this may backfire in the following way:
    //
    // filter = {
    //   name: {
    //     first: 'Abby',
    //     last: 'Shmabby'
    //   }
    // }
    //
    // result:
    //
    // {
    //   first: 'Abby',
    //   last: 'Shmabby',
    //   middle: 'Falama fama fo flabby'
    // }
    //
    // maybe this result is desired, maybe not
    //
    // should probably add STRICT_EQ as an operator
    forEachLeaf(value, ({ path, value }) => {
      path = path.slice()
      path.unshift(key)
      where(path.join('.'))[method](value)
    })
  }
}

const CHECK_EXISTS = ({ where, key, value }) => {
  if (value) {
    where(key).exists()
  } else {
    where(key).null()
  }
}

const COMPARATORS = {
  EQ: CREATE_EQUALITY_CHECK('eq'),
  NEQ: CREATE_EQUALITY_CHECK('ne'),
  EXISTS: CHECK_EXISTS,
  CONTAINS: ({ where, key, value }) => where(key).contains(value),
  NOT_CONTAINS: ({ where, key, value }) => where(key).notContains(value),
  STARTS_WITH: ({ where, key, value }) => where(key).beginsWith(value),
  LT: ({ where, key, value }) => where(key).lt(value),
  LTE: ({ where, key, value }) => where(key).lte(value),
  GT: ({ where, key, value }) => where(key).gt(value),
  GTE: ({ where, key, value }) => where(key).gte(value),
  IN: ({ where, key, value }) => where(key).in(value),
  BETWEEN: ({ where, key, value }) => where(key).between(...value),
}

const filterViaDynamoDB = co(function* ({
  table,
  models,
  model,
  filter,
  orderBy=defaultOrderBy,
  limit=DEFAULT_LIMIT,
  after,
  consistentRead
}) {
  filter = clone(filter || {})
  const { EQ } = filter
  const {
    opType,
    hashKey,
    queryProp,
    index,
    itemToPosition
  } = getQueryInfo({ table, model, filter, orderBy })

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

  addConditions({
    model,
    builder,
    opType,
    filter,
    // limit,
    orderBy,
    after,
    fullScanRequired
  })

  let result
  if (fullScanRequired) {
    result = yield exec(builder)
    result.Items = filterResults({
      models,
      model,
      filter,
      results: result.Items
    })
  } else {
    result = yield collect({ models, model, builder, filter, limit })
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
    startPosition = itemToPosition(items[0])
  } else {
    startPosition = after && itemToPosition(after)
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

module.exports = filterViaDynamoDB
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

function getStartKey (builder) {
  return builder.request.ExclusiveStartKey
}

function notNull (item) {
  return !!item
}

const collect = co(function* ({ models, model, builder, filter, limit }) {
  // limit how many items dynamodb iterates over before filtering
  // this is different from the sql-like notion of limit

  let batchLimit = limit
  if (!isEmpty(filter)) {
    batchLimit = limit * 2
    if (batchLimit < 10) batchLimit = 10
  }

  builder.limit(batchLimit)

  const result = yield exec(builder)
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

function addConditions ({
  model,
  opType,
  builder,
  filter,
  after,
  orderBy,
  fullScanRequired
}) {
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

  for (let op in filter) {
    let setCondition = COMPARATORS[op]
    if (!setCondition) {
      debug(`comparator ${op} is not implemented (yet)`)
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

// function usesNonPrimaryKeys ({ model, filter }) {
//   return props.some(prop => !indexed[prop])
// }

function forEachLeaf (obj, fn) {
  traverse(obj).forEach(function (value) {
    if (this.isLeaf) {
      fn({ value, path: this.path })
    }
  })
}

function isEmpty (obj) {
  return !obj || Object.keys(obj).length === 0
}

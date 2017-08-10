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
  promisify
} = require('./utils')

const OPERATORS = require('./operators')
const { hashKey } = require('./constants')
const { filterResults } = require('./filter-memory')
const DEFAULT_LIMIT = 50

const CREATE_EQUALITY_CHECK = method => {
  const checkStrict = ({ where, key, value }) => {
    return where(key)[method](value)
  }

  return function addEqualityCheck ({ where, key, value }) {
    if (method === 'ne' || typeof value !== 'object') {
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

module.exports = co(function* filterViaDynamoDB ({
  table,
  model,
  filter,
  orderBy,
  limit=DEFAULT_LIMIT,
  after
}) {
  filter = clone(filter || {})
  const { EQ } = filter
  const {
    opType,
    queryProp,
    index,
    itemToPosition
  } = getQueryInfo({ model, filter })

  const createBuilder = table[opType]
  let builder
  let fullScanRequired = true
  if (opType === 'query') {
  //   // supported key condition operators:
  //   // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions

    builder = createBuilder(EQ[queryProp])
    delete EQ[queryProp]
    if (index) {
      builder.usingIndex(index.name)
    }

    if (!orderBy) {
      orderBy = {
        property: queryProp
      }
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
    fullScanRequired = !!orderBy
    builder = createBuilder()
  }

  if (fullScanRequired) {
    builder.loadAll()
  }

  addConditions({
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
    result = yield promisify(builder.exec.bind(builder))()
    result.Items = filterResults({
      model,
      filter,
      results: result.Items
    })
  } else {
    result = yield collect({ model, builder, limit })
  }

  let items = result.Items
  let position
  if (items.length <= limit) {
    position = getStartKey(builder)
  } else {
    items = items.slice(0, limit)
    position = itemToPosition(items[items.length - 1])
  }

  if (orderBy) {
    items = sortResults({
      results: items,
      orderBy
    })
  }

  return {
    items,
    position,
    index,
    itemToPosition
  }
})

function getStartKey (builder) {
  return builder.request.ExclusiveStartKey
}

function notNull (item) {
  return !!item
}

const collect = co(function* ({ model, builder, filter, limit }) {
  // limit how many items dynamodb iterates over before filtering
  // this is different from the sql-like notion of limit
  let batchLimit = limit * 2
  if (batchLimit < 10) batchLimit = 10

  builder.limit(batchLimit)

  const result = yield promisify(builder.exec.bind(builder))()
  result.Items = filterResults({
    model,
    filter,
    results: resultsToJson(result.Items)
  })

  const getNextBatch = promisify(builder.continue.bind(builder))
  while (result.Count < limit && builder.canContinue()) {
    let batch = yield getNextBatch()
    if (batch.Count) {
      result.Count += batch.Count
      result.ScannedCount += batch.ScannedCount
      result.Items = result.Items.concat(filterResults({
        model,
        filter,
        results: resultsToJson(batch.Items)
      }))
    }

    if (!batch.LastEvaluatedKey) break
  }

  return result
})

function addConditions ({ opType, builder, filter, after, orderBy, fullScanRequired }) {
  if (after) {
    builder.startKey(after)
  }

  const conditionMethod = opType === 'query' ? 'filter' : 'where'
  const conditionBuilder = builder[conditionMethod].bind(builder)
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

      setCondition({
        where: conditionBuilder,
        key: prop,
        value: conditions[prop]
      })
    }
  }

  // if (fullScanRequired) {
  //   builder.loadAll()
  // }
  // else if (limit) {
  //   builder.limit(limit)
  // }

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

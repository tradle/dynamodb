const traverse = require('traverse')
const { clone, toObject, debug, getIndexes } = require('./utils')
const OPERATORS = require('./operators')
const { hashKey } = require('./constants')

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

module.exports = function filterViaDynamoDB ({ table, model, filter, orderBy, limit }) {
  filter = clone(filter || {})
  const indexes = getIndexes({ model })
  const usedProps = getUsedProperties({ model, filter })
  const indexedProps = indexes.map(index => index.hashKey)
    .concat(hashKey)

  const indexedPropsMap = toObject(indexedProps)
  const { EQ } = filter
  const usedIndexedProps = usedProps.filter(prop => {
    return EQ && prop in EQ && prop in indexedPropsMap
  })

  const opType = usedIndexedProps.length
    ? 'query'
    : 'scan'

  let createBuilder = table[opType]
  let builder
  let queryProp
  let fullScanRequired = true
  if (opType === 'query') {
    // supported key condition operators:
    //   http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions

    if (usedIndexedProps.includes(hashKey)) {
      queryProp = hashKey
    } else {
      queryProp = usedIndexedProps[0]
    }

    builder = createBuilder(EQ[queryProp])
    delete EQ[queryProp]
    if (queryProp !== hashKey) {
      const index = indexes.find(i => i.hashKey === queryProp)
      builder.usingIndex(index.name)
    }

    if (orderBy && orderBy.property === queryProp) {
      fullScanRequired = false
      if (orderBy.desc) {
        builder.descending()
      } else {
        builder.ascending()
      }
    }

  } else {
    builder = createBuilder()
  }

  addConditions({
    builder,
    opType,
    filter,
    limit,
    orderBy,
    fullScanRequired
  })

  return builder
}

function addConditions ({ opType, builder, filter, limit, orderBy, fullScanRequired }) {
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

  if (fullScanRequired) {
    if (limit) {
      debug('unable to set limit for db search operation, full scan is required')
    }

    builder.loadAll()
  } else if (limit) {
    builder.limit(limit)
  }

  return builder
}

function getUsedProperties ({ model, filter }) {
  const flat = flatten(filter)
  return flat.reduce((all, obj) => {
    return all.concat(Object.keys(obj))
  }, [])
}

// function usesNonPrimaryKeys ({ model, filter }) {
//   return props.some(prop => !indexed[prop])
// }

/**
 * flattens nested filter
 *
 * has no semantic meaning, this is just to be able to check
 * which props are being filtered against
 */
function flatten (filter) {
  const flat = []
  const batch = [filter]
  let len = batch.length
  while (batch.length) {
    let copy = batch.slice()
    batch.length = 0
    copy.forEach(subFilter => {
      for (let op in subFilter) {
        if (op in OPERATORS) {
          batch.push(subFilter[op])
        } else {
          flat.push(subFilter)
        }
      }
    })
  }

  return flat
}

function getLeaves (obj) {
  return traverse(obj).reduce(function (acc, value) {
    if (this.isLeaf) {
      return acc.concat({
        path: this.path,
        value
      })
    }

    return acc
  }, [])
}

function forEachLeaf (obj, fn) {
  traverse(obj).forEach(function (value) {
    if (this.isLeaf) {
      fn({ value, path: this.path })
    }
  })
}

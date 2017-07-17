const { clone, toObject, debug, getIndexes } = require('./utils')
const OPERATORS = require('./operators')
const { hashKey } = require('./constants')

// const COMPARATORS = {
//   EQ: ({ where, value }) => where.equals(value),
//   CONTAINS: ({ where, value }) => where.contains(value),
//   STARTS_WITH: ({ where, value }) => where.beginsWith(value),
//   LT: ({ where, value }) => where.lt(value),
//   LTE: ({ where, value }) => where.lte(value),
//   GT: ({ where, value }) => where.gt(value),
//   GTE: ({ where, value }) => where.gte(value),
//   IN: ({ where, value }) => where.in(value),
//   BETWEEN: ({ where, value }) => where.between(...value),
// }

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
  for (let op in filter) {
    let conditions = filter[op]
    for (let prop in conditions) {
      if (prop in OPERATORS) {
        debug('nested operators not support (yet)')
        continue
      }

      const where = builder[conditionMethod](prop)
      const value = conditions[prop]
      switch (op) {
      case 'EQ':
        where.equals(value)
        break
      case 'STARTS_WITH':
        where.beginsWith(value)
        break
      case 'CONTAINS':
        where.contains(value)
        break
      case 'LT':
        where.lt(value)
        break
      case 'LTE':
        where.lte(value)
        break
      case 'GT':
        where.gt(value)
        break
      case 'GTE':
        where.gte(value)
        break
      case 'IN':
        where.in(value)
        break
      case 'BETWEEN':
        where.between(...value)
        break
      default:
        debug(`unsupported operator ${op}`)
        break
      }
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

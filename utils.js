const debug = require('debug')(require('./package.json').name)
const bindAll = require('bindall')
const clone = require('clone')
const shallowClone = require('xtend')
const extend = require('xtend/mutable')
const deepEqual = require('deep-equal')
const pick = require('object.pick')
const omit = require('object.omit')
const traverse = require('traverse')
const co = require('co').wrap
const promisify = require('pify')
const dotProp = require('dot-prop')
const BaseObjectModel = require('@tradle/models')['tradle.Object']
const { TYPE } = require('@tradle/constants')
const { defaultPrimaryKeys, defaultIndexes, defaultOrderBy } = require('./constants')
const OPERATORS = require('./operators')

function getTableName ({ model, prefix='', suffix='' }) {
  const name = (model.id || model).replace(/[.]/g, '_')
  return prefix + name + suffix
}

function getIndexes (model) {
  return defaultIndexes.slice()
}

function sortResults ({ results, orderBy=defaultOrderBy }) {
  const { property, desc } = orderBy
  const asc = !desc // easier to think about
  if (property === defaultOrderBy.property) {
    return results.sort((a, b) => compare(a, b, property, asc))
  }

  return results.sort(function (a, b) {
    return compare(a, b, property, asc) ||
      compare(a, b, defaultOrderBy.property, asc)
  })
}

function compare (a, b, propertyName, asc) {
  const aVal = dotProp.get(a, propertyName)
  const bVal = dotProp.get(b, propertyName)
  if (aVal < bVal) return asc ? -1 : 1
  if (aVal > bVal) return asc ? 1 : -1

  return 0
}

function toObject (arr) {
  const obj = {}
  for (let val of arr) {
    obj[val] = true
  }

  return obj
}

function fromResourceStub (props) {
  const [type, permalink, link] = props.id.split('_')
  return {
    [TYPE]: type,
    link,
    permalink
  }
}

function resultsToJson (items) {
  // return items
  if (Array.isArray(items)) {
    return items.map(item => {
      return item.toJSON ? item.toJSON() : item
    })
  }

  return items.toJSON ? items.toJSON() : items
}

function getUsedProperties ({ model, filter }) {
  const flat = flatten(filter)
  return flat.reduce((all, obj) => {
    return all.concat(Object.keys(obj))
  }, [])
}

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

// function getLeaves (obj) {
//   return traverse(obj).reduce(function (acc, value) {
//     if (this.isLeaf) {
//       return acc.concat({
//         path: this.path,
//         value
//       })
//     }

//     return acc
//   }, [])
// }

function getQueryInfo ({ table, model, filter }) {
  const indexes = getIndexes({ model })
  // orderBy is not counted, because for a 'query' op,
  // a value for the indexed prop must come from 'filter'
  const usedProps = getUsedProperties({ model, filter })
  const { primaryKeys } = table
  const { hashKey, rangeKey } = primaryKeys
  const primaryKeysArr = getValues(primaryKeys)
  const indexedProps = indexes.map(index => index.hashKey)
    .concat(hashKey)

  const indexedPropsMap = toObject(indexedProps)
  const { EQ={} } = filter
  const usedIndexedProps = usedProps.filter(prop => {
    return prop in EQ && prop in indexedPropsMap
  })

  const opType = usedIndexedProps.length
    ? 'query'
    : 'scan'

  let builder
  let queryProp
  let fullScanRequired = true
  let index
  if (opType === 'query') {
    // supported key condition operators:
    // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions

    if (usedIndexedProps.includes(hashKey)) {
      queryProp = hashKey
    } else {
      queryProp = usedIndexedProps[0]
      index = indexes.find(i => i.hashKey === queryProp)
    }
  }

  const itemToPosition = function itemToPosition (item) {
    if (queryProp === hashKey || opType === 'scan') {
      return pick(item, [hashKey])
    }

    const props = primaryKeysArr
      .concat([index.hashKey, index.rangeKey])
      .filter(notNull)

    return pick(item, props)
  }

  return {
    opType,
    hashKey,
    rangeKey,
    queryProp,
    index,
    itemToPosition,
    filterProps: usedProps
  }
}

function runWithBackoffOnTableNotExists (fn, opts={}) {
  opts = shallowClone(opts)
  opts.shouldTryAgain = err => err.name === 'ResourceNotFoundException'
  return runWithBackoffWhile(fn, opts)
}

const runWithBackoffWhile = co(function* (fn, opts) {
  const {
    initialDelay=1000,
    maxAttempts=10,
    maxTime=60000,
    factor=2,
    shouldTryAgain
  } = opts

  const { maxDelay=maxTime/2 } = opts
  const start = Date.now()
  let millisToWait = initialDelay
  let attempts = 0
  while (Date.now() - start < maxTime && attempts++ < maxAttempts) {
    try {
      return yield fn()
    } catch (err) {
      if (!shouldTryAgain(err)) {
        throw err
      }

      let haveTime = start + maxTime - Date.now() > 0
      if (!haveTime) break

      millisToWait = Math.min(maxDelay, millisToWait * factor)
      yield wait(millisToWait)
    }
  }

  throw new Error('timed out')
})

function wait (millis) {
  return new Promise(resolve => setTimeout(resolve, millis))
}

const waitTillActive = co(function* (table) {
  const { tableName } = table
  const notReadyErr = new Error('not ready')
  yield runWithBackoffWhile(co(function* () {
    const { Table: { TableStatus } } = yield table.describeTable()
    switch (TableStatus) {
      case 'CREATING':
      case 'UPDATING':
        throw notReadyErr
      case 'ACTIVE':
        return
      case 'DELETING':
        throw new Error(`table "${tableName}" is being deleted`)
      default:
        const message = `table "${tableName}" has unknown TableStatus "${TableStatus}"`
        debug(table.tableName, message)
        throw new Error(message)
    }
  }), {
    initialDelay: 1000,
    maxDelay: 10000,
    shouldTryAgain: err => err === notReadyErr
  })
})

function getModelPrimaryKeys (model) {
  return model.primaryKeys || defaultPrimaryKeys
}

function getResourcePrimaryKeys ({ model, resource }) {
  const { hashKey, rangeKey } = getModelPrimaryKeys(model)
  const primaryKeys = {
    hashKey: resource[hashKey]
  }

  if (rangeKey) {
    primaryKeys[rangeKey] = resource[rangeKey]
  }

  return primaryKeys
}

function getValues (obj) {
  return Object.keys(obj).map(key => obj[key])
}

function notNull (val) {
  return !!val
}

module.exports = {
  BaseObjectModel,
  fromResourceStub,
  sortResults,
  co,
  promisify,
  debug,
  clone,
  shallowClone,
  extend,
  bindAll,
  deepEqual,
  pick,
  omit,
  traverse,
  toObject,
  getIndexes,
  getTableName,
  resultsToJson,
  getQueryInfo,
  runWithBackoffWhile,
  runWithBackoffOnTableNotExists,
  waitTillActive,
  getModelPrimaryKeys,
  getResourcePrimaryKeys,
  getValues
}

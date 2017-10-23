import crypto = require('crypto')
const debug = require('debug')(require('../package.json').name)
import bindAll = require('bindall')
import clone = require('clone')
import shallowClone = require('xtend')
import extend = require('xtend/mutable')
import deepEqual = require('deep-equal')
import pick = require('object.pick')
import omit = require('object.omit')
import promisify = require('pify')
import dotProp = require('dot-prop')
import levenshtein = require('fast-levenshtein')
const BaseObjectModel = require('@tradle/models')['tradle.Object']
import { TYPE } from '@tradle/constants'
import { defaultPrimaryKeys, defaultIndexes, defaultOrderBy } from './constants'
import OPERATORS = require('./operators')
import { IIndex, OrderBy, BucketChooser } from './types'

const levenshteinDistance = (a:string, b:string) => levenshtein.get(a, b)

function getTableName ({ model, prefix='', suffix='' }) {
  const name = (model.id || model).replace(/[.]/g, '_')
  return prefix + name + suffix
}

function getIndexes (model) {
  return defaultIndexes.slice()
}

function sortResults ({ results, orderBy=defaultOrderBy }: {
  results:any[],
  orderBy?:OrderBy
}) {
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

function getUsedProperties (filter) {
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

function getQueryInfo ({ bucket, filter, orderBy }) {
  // orderBy is not counted, because for a 'query' op,
  // a value for the indexed prop must come from 'filter'
  const usedProps = getUsedProperties(filter)
  const { indexes, primaryKeys } = bucket
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
  let resultsAreInOrder
  let index
  if (opType === 'query') {
    // supported key condition operators:
    // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions
    if (usedIndexedProps.includes(hashKey)) {
      queryProp = hashKey
      if (orderBy.property === rangeKey) {
        resultsAreInOrder = true
      }
    } else {
      queryProp = usedIndexedProps[0]
      index = indexes.find(i => i.hashKey === queryProp)
      if (orderBy.property === index.rangeKey) {
        resultsAreInOrder = true
      }
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
    filterProps: usedProps,
    resultsAreInOrder
  }
}

function runWithBackoffOnTableNotExists (fn, opts={}) {
  opts = shallowClone(opts)
  opts.shouldTryAgain = err => err.name === 'ResourceNotFoundException'
  return runWithBackoffWhile(fn, opts)
}

const runWithBackoffWhile = async (fn, opts) => {
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
      return await fn()
    } catch (err) {
      if (!shouldTryAgain(err)) {
        throw err
      }

      let haveTime = start + maxTime - Date.now() > 0
      if (!haveTime) break

      millisToWait = Math.min(maxDelay, millisToWait * factor)
      await wait(millisToWait)
    }
  }

  throw new Error('timed out')
}

function wait (millis) {
  return new Promise(resolve => setTimeout(resolve, millis))
}

const waitTillActive = async (table) => {
  const { tableName } = table
  const notReadyErr = new Error('not ready')
  await runWithBackoffWhile(async () => {
    const { Table: { TableStatus } } = await table.describeTable()
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
  }, {
    initialDelay: 1000,
    maxDelay: 10000,
    shouldTryAgain: err => err === notReadyErr
  })
}

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

function minBy<T> (arr:T[], fn:(T, i:number) => number):T {
  let min
  let minVal
  arr.forEach((item, i) => {
    if (typeof min === 'undefined') {
      min = item
      minVal = fn(item, i)
    } else {
      const val = fn(item, i)
      if (val < minVal) {
        min = item
        minVal = val
      }
    }
  })

  return min
}

function sha256 (data):string {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function defaultBackoffFunction (retryCount) {
  const delay = Math.pow(2, retryCount) * 500
  return Math.min(jitter(delay, 0.1), 10000)
}

function jitter (val, percent) {
  // jitter by val * percent
  // eslint-disable-next-line no-mixed-operators
  return val * (1 + 2 * percent * Math.random() - percent)
}

const tableNameErrMsg = "Table/index names must be between 3 and 255 characters long, and may contain only the characters a-z, A-Z, 0-9, '_', '-', and '.'"
const tableNameRegex = /^[a-zA-Z0-9-_.]{3,}$/
const validateTableName = (name:string) => {
  if (!tableNameRegex.test(name)) {
    throw new Error(`invalid table name "${name}", ${tableNameErrMsg}`)
  }
}

const expectedFilterTypeErrMsg = `filter.EQ.${[TYPE]} is required`
const getFilterType = (opts):string => {
  const { filter } = opts
  const EQ = filter && filter.EQ
  const type = EQ && EQ[TYPE]
  if (typeof type !== 'string') {
    throw new Error(expectedFilterTypeErrMsg)
  }

  return type
}

const lazyDefine = (obj:any, keys:string[], definer:Function):void => {
  keys.forEach(key => {
    let cachedValue
    Object.defineProperty(obj, key, {
      get: () => {
        if (!cachedValue) {
          cachedValue = definer(key)
        }

        return cachedValue
      },
      set: value => {
        cachedValue = value
      }
    })
  })
}

const utils = {
  BaseObjectModel,
  fromResourceStub,
  sortResults,
  promisify,
  debug,
  clone,
  shallowClone,
  extend,
  bindAll,
  deepEqual,
  pick,
  omit,
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
  getValues,
  minBy,
  sha256,
  wait,
  defaultBackoffFunction,
  validateTableName,
  getFilterType,
  lazyDefine,
  levenshteinDistance
}

export = utils

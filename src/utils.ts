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
import AWS = require('aws-sdk')
import toJoi = require('@tradle/schema-joi')
import { TYPE } from '@tradle/constants'
import Table from './table'
import { defaultPrimaryKeys, defaultIndexes, defaultOrderBy } from './constants'
import OPERATORS = require('./operators')
import {
  Model,
  Models,
  DynogelIndex,
  DynogelTableDefinition,
  OrderBy,
  TableChooser
} from './types'

import BaseObjectModel from './object-model'
const metadataTypes = toJoi({
  model: BaseObjectModel
})

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
  const props = flat.reduce((all, more) => {
    extend(all, more)
    return all
  }, {})

  return Object.keys(props)
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

function getPreferredQueryProperty ({ table, properties }: {
  table: Table,
  properties: string[]
}) {
  if (properties.length > 1) {
    const { indexes } = table
    const projectsAll = indexes.find(index => {
      return properties.includes(index.hashKey) &&
        index.projection.ProjectionType === 'ALL'
    })

    if (projectsAll) {
      return {
        index: projectsAll,
        property: projectsAll.hashKey,
        rangeKey: projectsAll.rangeKey
      }
    }

    if (properties.includes(table.hashKey)) {
      return {
        property: table.hashKey,
        rangeKey: table.rangeKey
      }
    }
  }

  const property = properties[0]
  const index = getIndexForProperty({ table, property })
  return {
    index,
    property,
    rangeKey: index && index.rangeKey
  }
}

function getIndexForProperty ({ table, property }) {
  return table.indexes.find(({ hashKey }) => hashKey === property)
}

function getQueryInfo ({ table, filter, orderBy }) {
  // orderBy is not counted, because for a 'query' op,
  // a value for the indexed prop must come from 'filter'
  const usedProps = getUsedProperties(filter)
  const { indexes, primaryKeys } = table
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
  let sortedByDB
  let index
  if (opType === 'query') {
    // supported key condition operators:
    // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions
    const preferred = getPreferredQueryProperty({ table, properties: usedIndexedProps })
    queryProp = preferred.property
    index = preferred.index
    if (orderBy.property === preferred.rangeKey) {
      sortedByDB = true
    }
  }

  const itemToPosition = function itemToPosition (item) {
    if (!item) throw new Error('expected database record')

    if (queryProp === hashKey || opType === 'scan') {
      return pick(item, primaryKeysArr)
    }

    const props = [index.hashKey, index.rangeKey].filter(notNull)
    const indexed = pick(item, props)
    return {
      ...indexed,
      ...table.getPrimaryKeys(item)
    }
  }

  return {
    opType,
    hashKey,
    rangeKey,
    queryProp,
    index,
    itemToPosition,
    filterProps: usedProps,
    sortedByDB
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

const getIndexForPrimaryKeys = ({ model }: {
  model:Model
}):DynogelIndex => {
  return {
    ...model.primaryKeys,
    type: 'global',
    name: model.primaryKeys.hashKey,
    projection: {
      ProjectionType: 'KEYS_ONLY'
    }
  }
}

const getTableDefinitionForModel = ({ models, model }: {
  models: Models,
  model:Model
}):DynogelTableDefinition => {
  const primaryKeys = model.primaryKeys || defaultPrimaryKeys
  return {
    // values are prefixed with type
    ...primaryKeys,
    tableName: getTableName({ model }),
    timestamps: false,
    // make this the reponsibility of the updating party
    // createdAt: false,
    // updatedAt: '_dateModified',
    schema: toJoi({ models, model }),
    indexes: model.primaryKeys ? [] : defaultIndexes,
    validation: {
      allowUnknown: true
    }
  }
}

const getDefaultTableDefinition = ({ tableName }: {
  tableName:string
}):DynogelTableDefinition => {
  return {
    // values are prefixed with type
    ...defaultPrimaryKeys,
    tableName,
    timestamps: false,
    // make this the reponsibility of the updating party
    // createdAt: false,
    // updatedAt: '_dateModified',
    schema: metadataTypes,
    indexes: defaultIndexes,
    validation: {
      allowUnknown: true
    }
  }
}

const toDynogelTableDefinition = (cloudformation:AWS.DynamoDB.CreateTableInput):DynogelTableDefinition => {
  const { TableName, KeySchema, GlobalSecondaryIndexes=[], AttributeDefinitions } = cloudformation
  const hashKey = KeySchema.find(key => key.KeyType === 'HASH').AttributeName
  const rangeKeyDef = KeySchema.find(key => key.KeyType === 'RANGE')
  const rangeKey = rangeKeyDef && rangeKeyDef.AttributeName
  const indexes = GlobalSecondaryIndexes.map(toDynogelIndexDefinition)
  const schema = {}
  return {
    tableName: TableName,
    hashKey,
    rangeKey,
    schema: {},
    indexes,
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    validation: {
      allowUnknown: true
    }
  }
}

const toDynogelIndexDefinition = (cloudformation:AWS.DynamoDB.GlobalSecondaryIndex):DynogelIndex => {
  const { KeySchema, Projection, ProvisionedThroughput, IndexName } = cloudformation
  const hashKey = KeySchema.find(key => key.KeyType === 'HASH').AttributeName
  const rangeKeyDef = KeySchema.find(key => key.KeyType === 'RANGE')
  return {
    hashKey,
    name: IndexName,
    type: 'global',
    rangeKey: rangeKeyDef && rangeKeyDef.AttributeName,
    projection: {
      ProjectionType: Projection.ProjectionType
    }
  }
}

const doesIndexProjectProperty = ({ table, index, property }: {
  table: Table,
  index: DynogelIndex,
  property:string
}) => {
  const { ProjectionType, NonKeyAttributes } = index.projection
  if (ProjectionType === 'ALL') {
    return true
  }

  if (ProjectionType === 'INCLUDE') {
    return NonKeyAttributes.includes(property)
  }

  return index.rangeKey === property || table.primaryKeyProps.includes(property)
}

const utils = {
  fromResourceStub,
  sortResults,
  compare,
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
  levenshteinDistance,
  getIndexForPrimaryKeys,
  getTableDefinitionForModel,
  getDefaultTableDefinition,
  toDynogelTableDefinition,
  toDynogelIndexDefinition,
  doesIndexProjectProperty
}

export = utils

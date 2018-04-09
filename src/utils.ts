import crypto = require('crypto')
import _ = require('lodash')
import bindAll = require('bindall')
import promisify = require('pify')
import levenshtein = require('fast-levenshtein')
import AWS = require('aws-sdk')
import Joi from 'joi'
import sort from 'array-sort'
import toJoi = require('@tradle/schema-joi')
import { TYPE } from '@tradle/constants'
import { Table } from './table'
import {
  // defaultOrderBy,
  minifiedFlag,
  separator,
  RANGE_KEY_PLACEHOLDER_VALUE,
  DEFAULT_RANGE_KEY,
  PRIMARY_KEYS_PROPS
} from './constants'

import {
  prefixString
} from './prefix'

import OPERATORS = require('./operators')
import {
  Model,
  Models,
  ITableDefinition,
  IDynogelIndex,
  IDynogelTableDefinition,
  OrderBy,
  TableChooser,
  FindOpts,
  PropsDeriver,
  ResolveOrderBy,
  IndexedProperty,
  GetIndexesForModel,
  GetPrimaryKeysForModel,
  IDynamoDBKey,
  KeyTemplate,
  KeyProps
} from './types'

const debug = require('debug')(require('../package.json').name)

export const levenshteinDistance = (a:string, b:string) => levenshtein.get(a, b)

export const cleanName = str => str.replace(/[.]/g, '_')

export const getTableName = ({ model, prefix='', suffix='' }) => {
  const name = cleanName(model.id || model)
  return prefix + name + suffix
}

// function getIndexes (model) {
//   return defaultIndexes.slice()
// }

export const sortResults = ({ results, orderBy, defaultOrderBy }: {
  results:any[]
  orderBy?:OrderBy
  defaultOrderBy?: OrderBy
}) => {
  // make sure both are initialized
  orderBy = orderBy || defaultOrderBy
  defaultOrderBy = defaultOrderBy || orderBy
  if (!orderBy) {
    debugger
    return results
  }

  const { property, desc } = orderBy
  if (property === defaultOrderBy.property) {
    return sort(results, property, { reverse: desc })
  }

  return sort(results, [property, defaultOrderBy.property], { reverse: desc })
}

export const compare = (a, b, propertyName) => {
  const aVal = _.get(a, propertyName)
  const bVal = _.get(b, propertyName)
  if (aVal < bVal) return -1
  if (aVal > bVal) return 1

  return 0
}

export const toObject = (arr) => {
  const obj = {}
  for (let val of arr) {
    obj[val] = true
  }

  return obj
}

export const fromResourceStub = (props) => {
  const [type, permalink, link] = props.id.split('_')
  return {
    [TYPE]: type,
    link,
    permalink
  }
}

export const resultsToJson = (items) => {
  // return items
  if (Array.isArray(items)) {
    return items.map(item => {
      return item.toJSON ? item.toJSON() : item
    })
  }

  return items.toJSON ? items.toJSON() : items
}

export const getUsedProperties = (filter) => {
  const flat = flatten(filter)
  const props = flat.reduce((all, more) => {
    _.extend(all, more)
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
export const flatten = (filter) => {
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

const OriginalBaseObjectModel = require('@tradle/models').models['tradle.Object']
const ObjectModelKeys = Object.keys(OriginalBaseObjectModel.properties)

export const getModelProperties = _.memoize(model => {
  return uniqueStrict(Object.keys(model.properties).concat(ObjectModelKeys))
}, model => model.id)

export const getMissingProperties = ({ resource, model, opts }: {
  resource,
  model,
  opts:FindOpts
}) => {
  let { select } = opts
  if (!select) {
    select = getModelProperties(model)
  }

  const missing = select.filter(prop => !(prop in resource))
  if (!missing.length) return missing

  const cut = resource[minifiedFlag]
  if (cut && cut.length) {
    const needsInflate = cut.some(prop => select.includes(prop))
    if (!needsInflate) return resource
  }

  return missing
}

type TablePropInfo = {
  property: string
  rangeKey?: string
  index?: IDynogelIndex
}

export const getPreferredQueryProperty = ({ table, properties }: {
  table: Table,
  properties: string[]
}):TablePropInfo => {
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
  if (property === table.hashKey) {
    return {
      property,
      rangeKey: table.rangeKey
    }
  }

  const index = getIndexForProperty({ table, property })
  return {
    index,
    property,
    rangeKey: index && index.rangeKey
  }
}

export const getIndexForProperty = ({ table, property }) => {
  return table.indexes.find(({ hashKey }) => hashKey === property)
}

export const getQueryInfo = ({ table, filter, orderBy, type }: {
  table: Table
  filter: any
  orderBy: any
  type: string
}) => {
  // orderBy is not counted, because for a 'query' op,
  // a value for the indexed prop must come from 'filter'
  const usedProps = getUsedProperties(filter)
  const { indexes, primaryKeys, primaryKeyProps, hashKeyProps } = table
  const { hashKey, rangeKey } = primaryKeys
  const indexedPropsMap = toObject(hashKeyProps)
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
  let defaultOrderBy
  if (opType === 'query') {
    // supported key condition operators:
    // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions
    const preferred = getPreferredQueryProperty({ table, properties: usedIndexedProps })
    queryProp = preferred.property
    index = preferred.index
    defaultOrderBy = { property: preferred.rangeKey }
    if (orderBy) {
      defaultOrderBy.desc = orderBy.desc
      orderBy = {
        ...orderBy,
        property: table.resolveOrderBy({
          type,
          hashKey: queryProp,
          property: orderBy.property
        })
      }
    } else {
      orderBy = defaultOrderBy
    }

    if (orderBy.property === preferred.rangeKey) {
      sortedByDB = true
    }
  } else {
    orderBy = {}
    if (rangeKey) {
      orderBy.property = rangeKey
    }
  }

  const itemToPosition = function itemToPosition (item) {
    item = {
      [TYPE]: type,
      ...item
    }

    item = table.withDerivedProperties(item)
    if (!item) throw new Error('expected database record')

    const primaryKeyValues = table.getPrimaryKeys(item)
    if (queryProp === hashKey || opType === 'scan') {
      return primaryKeyValues
    }

    const props = [index.hashKey, index.rangeKey].filter(notNull)
    const indexed = _.pick(item, props)
    return {
      ...indexed,
      ...primaryKeyValues
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
    sortedByDB,
    orderBy,
    defaultOrderBy
  }
}

function runWithBackoffOnTableNotExists (fn, opts:any={}) {
  opts = _.clone(opts)
  opts.shouldTryAgain = err => err.code === 'ResourceNotFoundException'
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

// function getModelPrimaryKeys (model) {
//   return model.primaryKeys || defaultPrimaryKeys
// }

// function getResourcePrimaryKeys ({ model, resource }) {
//   const { hashKey, rangeKey } = getModelPrimaryKeys(model)
//   const primaryKeys = {
//     hashKey: resource[hashKey]
//   }

//   if (rangeKey) {
//     primaryKeys[rangeKey] = resource[rangeKey]
//   }

//   return primaryKeys
// }

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

export const lazyDefine = (obj:any, keys:string[], definer:Function):void => {
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

export const getTableDefinitionForModel = ({ models, model }: {
  models: Models
  model: Model
}):IDynogelTableDefinition => {
  const { primaryKeys } = model
  return {
    // values are prefixed with type
    ...normalizeIndexedProperty(primaryKeys),
    tableName: getTableName({ model }),
    timestamps: false,
    // make this the reponsibility of the updating party
    // createdAt: false,
    // updatedAt: '_dateModified',
    schema: toJoi({ models, model }),
    indexes: [],
    validation: {
      allowUnknown: true
    }
  }
}

// const getDefaultTableDefinition = ({ tableName }: {
//   tableName:string
// }):IDynogelTableDefinition => {
//   return {
//     // values are prefixed with type

//     tableName,
//     timestamps: false,
//     // make this the reponsibility of the updating party
//     // createdAt: false,
//     // updatedAt: '_dateModified',
//     schema: defaultTableAttributes,
//     indexes: defaultIndexes,
//     validation: {
//       allowUnknown: true
//     }
//   }
// }

const cfToJoi = {
  N: Joi.number(),
  S: Joi.string()
}

export const toDynogelTableDefinition = (cloudformation:AWS.DynamoDB.CreateTableInput):IDynogelTableDefinition => {
  const { TableName, KeySchema, GlobalSecondaryIndexes=[], AttributeDefinitions } = cloudformation
  const hashKey = KeySchema.find(key => key.KeyType === 'HASH').AttributeName
  const rangeKeyDef = KeySchema.find(key => key.KeyType === 'RANGE')
  const rangeKey = rangeKeyDef && rangeKeyDef.AttributeName
  const indexes = GlobalSecondaryIndexes.map(toDynogelIndexDefinition)
  const schema = {}
  AttributeDefinitions.forEach(def => {
    schema[def.AttributeName] = cfToJoi[def.AttributeType]
  })

  return {
    tableName: TableName,
    hashKey,
    rangeKey,
    schema,
    indexes,
    timestamps: false,
    createdAt: false,
    updatedAt: false,
    validation: {
      allowUnknown: true
    }
  }
}

export const toDynogelIndexDefinition = (cloudformation:AWS.DynamoDB.GlobalSecondaryIndex):IDynogelIndex => {
  const { KeySchema, Projection, ProvisionedThroughput, IndexName } = cloudformation
  const hashKey = KeySchema.find(key => key.KeyType === 'HASH').AttributeName
  const rangeKeyDef = KeySchema.find(key => key.KeyType === 'RANGE')
  return {
    hashKey,
    name: IndexName,
    type: 'global',
    rangeKey: rangeKeyDef && rangeKeyDef.AttributeName,
    projection: _.pick(Projection, ['ProjectionType', 'NonKeyAttributes'])
  }
}

export const doesIndexProjectProperty = ({ table, index, property }: {
  table: Table,
  index: IDynogelIndex,
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

export const uniqueStrict = arr => {
  const map = new Map()
  const uniq:any[] = []
  for (const item of arr) {
    if (!map.has(item)) {
      map.set(item, true)
      uniq.push(item)
    }
  }

  return uniq
}

// const cachify = (get:Function, cache:Cache) => {
//   const cachified = async (...args) => {
//     const str = stableStringify(args)
//     const cached = cache.get(str)
//     if (cached) {
//       // refetch on error
//       return cached.catch(err => cachified(...args))
//     }

//     const result = get(...args)
//     result.catch(err => cache.del(str))
//     cache.set(str, result)
//     return result
//   }

//   return cachified
// }

export const hookUp = (fn, event) => async function (...args) {
  await this.hooks.fire(`${event}:pre`, { args })
  const result = await fn.apply(this, args)
  await this.hooks.fire(`${event}:post`, { args, result })
  return result
}


export const getTemplateStringVariables = (str: string) => {
  const match = str.match(/\{\{([^}]+)\}\}/g)
  if (match) {
    return match.map(part => part.slice(2, part.length - 2))
  }

  return []
}

export const canRenderTemplate = (template, item) => {
  const paths = getTemplateStringVariables(template)
  return paths.every(path => typeof _.get(item, path) !== 'undefined')
}

const TEMPLATE_SETTINGS = /{{([\s\S]+?)}}/g
export const renderTemplate = (str, data) => _.template(str, {
  interpolate: TEMPLATE_SETTINGS
})(data)

export const normalizeIndexedProperty = (property: any):KeyProps => {
  if (typeof property === 'string') {
    return { hashKey: property }
  }

  PRIMARY_KEYS_PROPS.forEach(key => {
    if (typeof property[key] !== 'string') {
      throw new Error(`expected string "${key}"`)
    }
  })

  return _.pick(property, PRIMARY_KEYS_PROPS)
}

export const normalizeIndexedPropertyTemplateSchema = (property:any):IndexedProperty => {
  if (typeof property === 'string' || Array.isArray(property)) {
    return {
      hashKey: getKeyTemplateFromProperty([].concat(property).join('.'))
    }
  }

  const { hashKey, rangeKey } = property
  if (!hashKey) throw new Error('expected "hashKey"')

  return {
    hashKey: typeof hashKey === 'string' ? getKeyTemplateFromProperty(hashKey) : hashKey,
    rangeKey: typeof rangeKey === 'string' ? getKeyTemplateFromProperty(rangeKey) : rangeKey,
  }
}

export const getKeyTemplateFromProperty = (property:string):KeyTemplate => ({ template: `{{${property}}}` })

export const pickNonNull = (obj, props) => [].concat(props).reduce((picked, prop) => {
  if (obj[prop] != null) {
    picked[prop] = obj[prop]
  }

  return picked
}, {})

// export const ensureRangeKey = (index: IndexedProperty):IndexedProperty => ({
//   ...index,
//   rangeKey: index.rangeKey || RANGE_KEY_PLACEHOLDER_VALUE
// })

export const getExpandedProperties = model => ({
  ...model.properties,
  ...OriginalBaseObjectModel.properties
})

export {
  promisify,
  debug,
  bindAll,
  // getIndexes,
  runWithBackoffWhile,
  runWithBackoffOnTableNotExists,
  waitTillActive,
  // getModelPrimaryKeys,
  // getResourcePrimaryKeys,
  minBy,
  sha256,
  wait,
  defaultBackoffFunction,
  validateTableName,
  getFilterType,
  // cachify
}

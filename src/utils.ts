import crypto from 'crypto'
import getPropByPath from 'lodash/get'
import setPropAtPath from 'lodash/set'
import extend from 'lodash/extend'
import memoize from 'lodash/memoize'
import pick from 'lodash/pick'
import clone from 'lodash/clone'
import flatMap from 'lodash/flatMap'
import flatten from 'lodash/flatten'
import transform from 'lodash/transform'
import identityFn from 'lodash/identity'
import zipObject from 'lodash/zipObject'
import compileTemplate from 'lodash/template'
import bindAll from 'bindall'
import promisify from 'pify'
import traverse from 'traverse'
import levenshtein from 'fast-levenshtein'
import AWS from 'aws-sdk'
import Joi from 'joi'
import sort from 'array-sort'
import {
  AttributePath,
  PathElement,
  UpdateExpression,
  ConditionExpression,
  ExpressionAttributes
} from '@aws/dynamodb-expressions'
import toJoi from '@tradle/schema-joi'
import { TYPE } from '@tradle/constants'
import validateModels from '@tradle/validate-model'
import validateResource from '@tradle/validate-resource'
import { Table } from './table'
import * as defaults from './defaults'
import {
  // defaultOrderBy,
  minifiedFlag,
  RANGE_KEY_PLACEHOLDER_VALUE,
  DEFAULT_RANGE_KEY,
  PRIMARY_KEYS_PROPS
} from './constants'

import {
  prefixString
} from './prefix'

import OPERATORS from './operators'
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
  KeyProps,
  DerivedPropsParser,
  PropPath,
  Filter
} from './types'

const debug = require('debug')(require('../package.json').name)
const { getNestedProperties } = validateModels.utils
const { marshall, unmarshall } = AWS.DynamoDB.Converter
const fixUnmarshallItem = item => traverse(item).map(function (value) {
  // unwrap Set instances
  if (value &&
    value.values &&
    value.constructor !== Object) {
    this.update(value.values)
  }
})

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
  const aVal = getPropByPath(a, propertyName)
  const bVal = getPropByPath(b, propertyName)
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
  const flat = flattenFilter(filter)
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
export const flattenFilter = (filter) => {
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

export const getModelProperties = memoize(model => {
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
    const indexed = pick(item, props)
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
  opts = clone(opts)
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
    projection: pick(Projection, ['ProjectionType', 'NonKeyAttributes'])
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
  if (!str) debugger
  const match = str.match(/\{([^}]+)\}/g)
  if (match) {
    return match.map(part => part.slice(1, part.length - 1))
  }

  return []
}

export const getTemplateStringValues = getTemplateStringVariables

export const canRenderTemplate = (template:string, item:any, noConstants?:boolean) => {
  const paths = getTemplateStringVariables(template)
  if (!paths.length && noConstants) return false

  return paths.every(path => typeof getPropByPath(item, path) !== 'undefined')
}

const TEMPLATE_SETTINGS = /{([\s\S]+?)}/g
export const renderTemplate = (str, data) => {
  const render = compileTemplate(str, {
    interpolate: TEMPLATE_SETTINGS
  })

  data = encodeTemplateValues(data)
  return render(data)
}

/**
 * This is done to be able to parse the template values out
 * and match them to property names in post-query/scan processing
 */
export const encodeTemplateValues = data => traverse(data).map(function (val) {
  if (this.circular) throw new Error('unexpected circular reference')

  if (this.isLeaf) {
    this.update('{' + encodeURIComponent(val) + '}')
  }
}, {})

// const encodeTemplateValues = data => _.transform(data, (encoded, value, key) => {
//   if (value == null) return

//   if (typeof value === 'object') {
//     encoded[key] = encodeValues(value)
//   } else {
//     encoded[key] = '{' + encodeURIComponent(value) + '}'
//   }
// }, {})

export const normalizeIndexedProperty = (property: any):KeyProps => {
  if (typeof property === 'string') {
    return { hashKey: property }
  }

  PRIMARY_KEYS_PROPS.forEach(key => {
    if (typeof property[key] !== 'string') {
      throw new Error(`expected string "${key}"`)
    }
  })

  return pick(property, PRIMARY_KEYS_PROPS)
}

export const normalizeIndexedPropertyTemplateSchema = (property:any):IndexedProperty => {
  if (typeof property === 'string' || Array.isArray(property)) {
    return {
      hashKey: { template: getKeyTemplateString(property) }
    }
  }

  const { hashKey, rangeKey } = property
  if (!hashKey) throw new Error('expected "hashKey"')

  const ret = <IndexedProperty>{}
  for (const key of PRIMARY_KEYS_PROPS) {
    const val = property[key]
    if (!val) continue

    if (val.template) {
      ret[key] = val
    } else {
      ret[key] = {
        template: getKeyTemplateString(val)
      }
    }
  }

  return ret
}

export const getKeyTemplateString = (val:string|string[]) => {
  if (typeof val === 'string') {
    if (getTemplateStringVariables(val).length) {
      return val
    }

    return `{${val}}`
  }

  if (Array.isArray(val)) {
    return val.map(getKeyTemplateString).join('')
  }

  throw new Error(`unable to parse template string`)
}

// export const getKeyTemplateFromProperty = (property:string):KeyTemplate => ({ template: `{{${property}}}` })

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

export const getExpandedProperties = memoize(({ models, model }) => ({
  ...model.properties,
  ...OriginalBaseObjectModel.properties,
  ...getNestedProperties({ models, model })
}), ({ model }) => model.id)


export const getIndexesForModel:GetIndexesForModel = ({ table, model }: {
  table: Table
  model: Model
}) => {
  return (model.indexes || defaults.indexes).map(index => normalizeIndexedPropertyTemplateSchema(index))
}

export const getPrimaryKeysForModel: GetPrimaryKeysForModel = ({ table, model }: {
  table: Table
  model: Model
}) => {
  if (!model) debugger
  return normalizeIndexedPropertyTemplateSchema(model.primaryKeys || defaults.primaryKeys)
}

export const resolveOrderBy: ResolveOrderBy = ({
  table,
  type,
  hashKey,
  property
}: {
  table: Table
  type: string
  hashKey: string
  property: string
}) => {
  const model = table.models[type]
  if (!model) return

  const index = table.indexed.find(index => index.hashKey === hashKey)
  const indexes = table.getKeyTemplatesForModel(model)
  const indexedProp = indexes[table.indexed.indexOf(index)]
  if (!(indexedProp && indexedProp.rangeKey)) return

  const rangeKeyDerivesFromProp = canRenderTemplate(indexedProp.rangeKey.template, { [property]: 'placeholder' })
  if (rangeKeyDerivesFromProp) {
    return index.rangeKey
  }
}

const encodeHashKeyTemplate = (type: string, value: string) => type + value
const decodeHashKeyTemplate = (value: string) => {
  const idx = value.indexOf('{')
  if (idx === -1) {
    return { type: value }
  }

  return {
    type: value.slice(0, idx),
    value: value.slice(idx)
  }
}

export const deriveProps: PropsDeriver = ({
  table,
  item,
  isRead,
  noConstants
}) => {
  if (!table.derivedProps.length) {
    debugger
    return {}
  }

  // expand '.' props
  item = expandNestedProps(item)

  let rType = item[TYPE]
  if (!rType) {
    const { hashKey } = table.indexed.find(i => i.hashKey in item)
    if (!hashKey) {
      throw new Error('unable to deduce resource type')
    }

    rType = decodeHashKeyTemplate(item[hashKey]).type
  }

  const model = table.models[rType]
  const indexes = table.getKeyTemplatesForModel(model)
  const renderable = indexes
    .map((templates, i) => {
      const { hashKey, rangeKey } = table.indexed[i]
      const ret = [{
        property: hashKey,
        template: encodeHashKeyTemplate(rType, templates.hashKey.template)
      }]

      if (rangeKey) {
        ret.push({
          property: rangeKey,
          template: templates.rangeKey ? templates.rangeKey.template : RANGE_KEY_PLACEHOLDER_VALUE
        })
      }

      return ret
    })
    .reduce((all, some) => all.concat(some), [])
    // only render the keys for which we have all the variables
    .filter(({ template }) => canRenderTemplate(template, item, noConstants))

  return renderable.reduce((inputs, { property, template }) => {
    const val = renderTemplate(template, item)
    if (val.length) {
      // empty strings not allowed!
      inputs[property] = val
    }

    return inputs
  }, {})
}

export const parseDerivedProps:DerivedPropsParser = ({ table, model, resource }) => {
  const { models } = table
  const templates = flatMap(
    table.getKeyTemplatesForModel(model),
    ({ hashKey, rangeKey }) => {
      return [
        {
          ...hashKey,
          type: 'hash'
        },
        rangeKey && {
          ...rangeKey,
          type: 'range'
        }
      ]
    }
  )
  .filter(identityFn)
  // .filter(info => /^[{]{2}[^}]+[}]{2}$/.test(info.template))

  const derived = pick(resource, table.derivedProps)
  const properties = getExpandedProperties({ models, model })
  return transform(derived, (parsed, value, prop) => {
    const info = templates.find(({ key }) => key === prop)
    if (!info) return

    const { key, template, type } = info
    let propVal = value
    if (type === 'hash') {
      propVal = decodeHashKeyTemplate(propVal).value
      if (typeof propVal === 'undefined') return
    }

    const propPaths = getTemplateStringVariables(template)
    const propVals = getTemplateStringVariables(propVal).map(decodeURIComponent)
    const pathToVal = zipObject(propPaths, propVals)
    Object.keys(pathToVal).forEach(propPath => {
      const propMeta = properties[propPath]
      if (!propMeta) return

      let val = pathToVal[propPath]
      const pType = propMeta.type
      // complex props not supported at the moment
      if (pType === 'array' || pType === 'object') return

      if (pType === 'number' || pType === 'date') {
        val = parseInt(val, 10)
      } else if (pType === 'boolean') {
        val = val === 'true' || val === '1'
      }

      // use _.set as propPath may be a nested prop, e.g. blah._permalink
      setPropAtPath(parsed, propPath, val)
    })
  }, {
    [TYPE]: model.id
  })
}

const expandNestedProps = obj => {
  const expanded = {}
  for (let key in obj) {
    setPropAtPath(expanded, key, obj[key])
  }

  return expanded
}

export const getTableKeys = (def:IDynogelTableDefinition) => {
  const { hashKey, rangeKey } = def
  return [hashKey, rangeKey]
    .concat(flatten(def.indexes.map(def => [def.hashKey, def.rangeKey])))
    .filter(identityFn)
}

export const toAttributePath = (path: PropPath) => {
  const parts = [].concat(path).map(name => ({
    type: 'AttributeName',
    name
  })) as PathElement[]

  return new AttributePath(parts)
}

export const marshallDBItem = item => marshall(item)
export const unmarshallDBItem = item => fixUnmarshallItem(unmarshall(item))
export const createUpdateOptionsFromDiff = diff => {
  const atts = new ExpressionAttributes()
  const updateExp = new UpdateExpression()
  diff.forEach(({ op, path, value }) => {
    const attPath = toAttributePath(path)
    if (op === 'remove') {
      updateExp.remove(attPath)
    } else {
      updateExp.set(attPath, value)
    }
  })

  const updateExpStr = updateExp.serialize(atts)
  return {
    UpdateExpression: updateExpStr,
    ExpressionAttributeNames: atts.names,
    ExpressionAttributeValues: unmarshallDBItem(atts.values)
  }
}

export const getDecisionProps = ({ filter, select }: {
  filter?: Filter
  select?: string[]
}) => {
  const props = (select || []).concat(getUsedProperties(filter || {}))
  return uniqueStrict(props)
}

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

import { EventEmitter } from 'events'
import levenshtein = require('fast-levenshtein')
import dynogels = require('dynogels')
import { TYPE, SIG } from '@tradle/constants'
import toJoi = require('@tradle/schema-joi')
import BaseModels = require('@tradle/models')
import validateResource = require('@tradle/validate-resource')
import promisify = require('pify')
import { minifiedFlag, batchWriteLimit, defaultOrderBy, defaultIndexes } from './constants'
import { IIndex, KeyProps, IBucketOpts, BackoffOptions } from './types'
import {
  debug,
  wait,
  defaultBackoffFunction,
  pick,
  omit,
  clone,
  sha256,
  validateTableName,
  getFilterType,
  getValues,
  getTableName
} from './utils'

import minify from './minify'
import Errors = require('./errors')
import filterDynamoDB from './filter-dynamodb'
import OPERATORS = require('./operators')
import {
  prefixKeys,
  unprefixKeys,
  prefixString,
  getUniquePrefix
} from './prefix'

const DEFAULT_PRIMARY_KEYS:KeyProps = {
  hashKey: '_tpermalink'
}

// TODO: add this prop to tradle.Object
const DATE_MODIFIED_PROPERTY = '_dateModified'

const BaseObjectModel = clone(BaseModels['tradle.Object'])
BaseObjectModel.properties._tpermalink = {
  type: 'string',
  virtual: true
}

BaseObjectModel.required.push('_tpermalink')
const DONT_PREFIX = Object.keys(BaseObjectModel.properties)
const metadataTypes = toJoi({
  model: BaseObjectModel
})

const defaultOpts = {
  maxresourceSize: Infinity,
  requireSigned: true,
  bodyInObjects: true,
  forbidScan: false,
  validate: false,
  defaultReadOptions: {}
}

const defaultBackoffOpts:BackoffOptions = {
  backoff: defaultBackoffFunction,
  maxTries: 6
}

function distance (a, b) {
  return levenshtein.get(a, b)
}

// function getClosestBucket (str, buckets) {
//   const hash = sha256(str)
//   return minBy(buckets, candidate => distance(candidate, hash))
// }

export default class Bucket extends EventEmitter {
  public name:string
  public models:any
  public objects:any
  private opts:any
  private modelsStored:{[key:string]: any}
  private indexes:IIndex[]
  private _prefix:{[key:string]: string}
  private tableDef:any
  private table:any
  private exclusive:boolean
  private findOpts:object
  private primaryKeys:KeyProps
  private primaryKeyProps:string[]
  public static distance = (a:string, b:string):number => {
    return Bucket.distanceRaw(sha256(a), b)
  }

  public static distanceRaw = (a:string, b:string):number => distance(a, b)

  get hashKey() {
    return this.primaryKeys.hashKey
  }

  get rangeKey() {
    return this.primaryKeys.rangeKey
  }

  constructor (name, opts:IBucketOpts) {
    super()
    validateTableName(name)
    this.opts = { ...defaultOpts, ...opts }
    const {
      models,
      model,
      objects,
      exclusive,
      primaryKeys,
      requireSigned,
      forbidScan,
      bodyInObjects,
      defaultReadOptions={},
      indexes
    } = this.opts

    if (exclusive && !model) {
      throw new Error('expected "model" when "exclusive" is true')
    }

    this.name = name
    this.models = models
    this.objects = objects
    this.modelsStored = {}
    this.exclusive = exclusive
    this.model = model
    this._prefix = {}
    if (exclusive) {
      this.primaryKeys = primaryKeys || model.primaryKeys
    } else {
      this.primaryKeys = DEFAULT_PRIMARY_KEYS
    }

    this.findOpts = pick(opts, [
      'models',
      'forbidScan',
      'bodyInObjects'
    ])

    if (defaultReadOptions.consistentRead) {
      this.findOpts.consistentRead = true
    }

    this.findOpts.primaryKeys = this.primaryKeys
    this.primaryKeyProps = getValues(this.primaryKeys)

    // easier to think of everything as indexes
    // even the main table schema
    this.indexes = indexes || defaultIndexes.slice()
      // {
      //   ...this.primaryKeys,
      //   name: this.primaryKeys.hashKey,
      //   type: 'global',
      //   projection: {
      //     ProjectionType: 'ALL'
      //   }
      // }

    // invalidate cached table
    if (exclusive) {
      this.addModel({ model })
    }

    this._defineTable()
    this.on('def:update', () => this.table = null)
    this._debug('initialized')
  }

  public inflate = async (resource):Promise<any> => {
    this._debug(`inflating ${resource[TYPE]} from object store`)
    const link = resource._link
    const full = await this.objects.get(link)
    resource = { ...resource, ...full }
    delete resource[minifiedFlag]
    return resource
  }

  public addModel = ({ model, indexes }: {
    model,
    indexes?:IIndex[]
  }) => {
    if (!this.modelsStored[model.id]) {
      this.modelsStored[model.id] = model
      this._debug(`will store resources of model ${model.id}`)
    }

    if (!(indexes && indexes.length)) return

    this.indexes = this.indexes.concat(indexes.map(index => {
      return {
        ...index,
        hashKey: this.prefixKey({
          type: model.id,
          key: index.hashKey
        }),
        rangeKey: index.rangeKey && this.prefixKey({
          type: model.id,
          key: index.rangeKey
        })
      }
    }))

    this.tableDef = this._getTableDef()
    this.emit('def:update')
  }

  public get = async (query, opts={}):Promise<any> => {
    this._debug(`get() ${JSON.stringify(query)}`)
    query = this.toDBFormat(query)
    const keys = getValues(this._getPrimaryKeys(query))
    const result = await this.table.get(...keys, {
      ...this.opts.defaultReadOptions,
      ...opts
    })

    if (!result) {
      throw new Errors.NotFound(`query: ${JSON.stringify(query)}`)
    }

    const resource = await this._maybeInflate(this.fromDBFormat(result.toJSON()))
    return this._exportResource(resource)
  }

  public latest = async (query, opts={}):Promise<any> => {
    if (this.hashKey === '_tpermalink') {
      return this.get(query, opts)
    }

    throw new Error('only supported when hashKey is _tpermalink')
  }

  public del = async (query, opts={}):Promise<any> => {
    query = this.toDBFormat(query)
    const keys = getValues(this._getPrimaryKeys(query))
    const result = await this.table.destroy(...keys, opts)
  }

  private _exportResource = resource => omit(resource, '_tpermalink')

  public batchPut = async (
    resources:any[],
    backoffOpts=defaultBackoffOpts
  ) => {
    const { maxItemSize } = this.opts
    resources.forEach(this._validateResource)

    const minified = resources.map(item => minify({
      model: item[TYPE],
      item,
      maxSize: maxItemSize
    }))

    let mins = minified.map(({ min }) => this.toDBFormat(min))
    let batch
    while (mins.length) {
      batch = mins.slice(0, batchWriteLimit)
      mins = mins.slice(batchWriteLimit)
      await this._batchPut(batch, backoffOpts)
      this._debug(`batchPut ${batch.length} items successfully`)
    }

    return resources
  }

  public put = async (resource):Promise<void> => {
    this._debug(`put() ${resource[TYPE]}`)
    await this._write('create', resource)
  }

  public update = async (resource):Promise<void> => {
    this._debug(`update() ${resource[TYPE]}`)
    await this._write('update', resource)
  }

  public find = async (opts) => {
    opts = {
      ...this.findOpts,
      ...clone(opts),
      bucket: this
    }

    // ensure type is set on filter
    getFilterType(opts)

    this._debug(`find() ${opts.filter.EQ[TYPE]}`)
    const results = await filterDynamoDB(opts)
    this._debug(`find returned ${results.items.length} results`)
    results.items = await Promise.all(results.items.map(resource => {
      return this._maybeInflate(resource, opts)
    }))

    results.items = results.items.map(resource => this._exportResource(resource))
    return results
  }

  public search = (...args) => this.find(...args)

  public getPrefix = function (type:string|any):string {
    if (typeof type === 'object') {
      type = type[TYPE]
    }

    if (!this._prefix[type]) {
      this._prefix[type] = getTableName({ model: this.models[type] })
    }

    return this._prefix[type]
  }

  public create = async ():Promise<void> => {
    this._debug('create() table')
    try {
      await this.table.createTable()
    } catch (err) {
      if (err.code === 'ResourceInUseException') {
        this._debug('table already exists')
      } else {
        throw err
      }
    }

    this._debug('created table')
  }

  public destroy = async ():Promise<void> => {
    this._debug('destroy() table')
    try {
      await this.table.destroyTable()
    } catch (err) {
      if (err.code === 'ResourceNotFoundException') {
        this._debug('table does not exist')
      } else {
        throw err
      }
    }

    this._debug('destroyed table')
  }

  private _debug = (...args):void => {
    args.unshift(this.name)
    debug(...args)
  }

  private _getTableDef = () => {
    const { models, model } = this
    return {
      // values are prefixed with type
      ...this.primaryKeys,
      tableName: this.name,
      timestamps: true,
      createdAt: false,
      updatedAt: DATE_MODIFIED_PROPERTY,
      schema: this.exclusive
        ? toJoi({ models, model })
        : metadataTypes,
      indexes: this.indexes,
      validation: {
        allowUnknown: true
      }
    }
  }

  private _defineTable = () => {
    if (!this.tableDef) {
      this._debug('using default definition for table')
      this.tableDef = this._getTableDef()
    }

    const table = dynogels.define(this.name, this.tableDef)
    this.table = promisify(table, {
      include: [
        'createTable',
        'deleteTable',
        'describeTable',
        'create',
        'get',
        'update',
        'destroy'
      ]
    })

    ;['scan', 'query'].forEach(op => {
      this[op] = (...args) => {
        const builder = table[op](...args)
        builder.exec = this._wrapDBOperation(builder.exec.bind(builder))
        return builder
      }
    })
  }

  public toDBFormat = (resource) => {
    resource = {
      ...resource,
      _tpermalink: this._getTPermalink(resource)
    }

    return this.prefixProperties(resource)
  }

  public fromDBFormat = (resource) => {
    return this.unprefixProperties(resource)
  }

  public prefixKey = ({ type, key }: { type:string, key:string }):string => {
    return DONT_PREFIX.includes(key)
      ? key
      : prefixString(key, this.getPrefix(type))
  }

  public prefixProperties = function (resource) {
    return this.prefixPropertiesForType(resource[TYPE], resource)
  }

  public prefixPropertiesForType = function (type:string, properties:any) {
    return this.exclusive
      ? properties
      : prefixKeys(properties, this.getPrefix(type), DONT_PREFIX)
  }

  public unprefixProperties = function (resource) {
    return this.unprefixPropertiesForType(resource[TYPE], resource)
  }

  public unprefixPropertiesForType = function (type:string, resource:any) {
    return this.exclusive
      ? resource
      : unprefixKeys(resource, this.getPrefix(type), DONT_PREFIX)
  }

  private _wrapDBOperation = (fn:Function):Function => {
    const promisified = async (...args) => {
      const result = await promisify(fn)(...args)
      if (!result) return result

      const { Item, Items } = result
      if (Item) {
        result.Item = Item.toJSON()
        result.Item = this.fromDBFormat(result.Item)
        await this._maybeInflate(result.Item)
      } else if (Items) {
        result.Items = Items
          .map(Item => Item.toJSON())
          .map(item => this.fromDBFormat(item))

        await Promise.all(result.Items.map(Item => this._maybeInflate(Item)))
      }

      return result
    }

    return function (...args) {
      const callback = args.pop()
      Promise.resolve(promisified(...args))
        .catch(callback)
        .then(result => callback(null, result))
    }
  }

  private _maybeInflate = async (resource, options={}):Promise<any> => {
    const { force, select } = options
    const cut = resource[minifiedFlag]
    if (force || (cut && cut.length)) {
      if (select) {
        const needsInflate = cut.some(prop => select.includes(prop))
        if (!needsInflate) return resource
      }

      resource = await this.inflate(resource)
    }

    return resource
  }

  private _write = async (method:string, resource:any):Promise<void> => {
    const type = resource[TYPE]
    const model = this.modelsStored[type]
    if (!model) throw new Error(`model not found: ${type}`)

    let options
    let current
    if (this.hashKey === '_tpermalink') {
      options = {
        ConditionExpression: 'attribute_not_exists(#tpermalink) OR #link = :link OR #time < :time',
        ExpressionAttributeNames: {
          '#time' : '_time',
          '#tpermalink': '_tpermalink',
          '#link': '_link',
        },
        ExpressionAttributeValues: {
          ':time' : resource._time,
          ':link': resource._link
        }
      }
    }

    const { min, diff } = minify({
      model,
      item: resource,
      maxSize: this.opts.maxItemSize
    })

    const formatted = this.toDBFormat(min)
    const result = await this.table[method](formatted, options)
    const primaryKeys = this._getPrimaryKeys(formatted)
    this._debug(`"${method}" ${JSON.stringify(primaryKeys)} successfully`)
  }

  private _validateResource = (resource) => {
    const self = this
    const { models, requireSigned } = this.opts
    const { modelsStored } = this
    const type = resource[TYPE]
    const model = models[type]
    if (!model) {
      throw new Error(`missing model ${type}`)
    }

    // const missingKeyProp = this.primaryKeyProps.find(prop => resource[prop] == null)
    // if (missingKeyProp) {
    //   throw new Error(`expected: ${missingKeyProp}`)
    // }

    if (requireSigned && !resource[SIG]) {
      const keys = JSON.stringify(this._getPrimaryKeys(resource))
      throw new Error(`expected resource to be signed: ${keys}`)
    }

    validateResource({ models, model, resource })
  }

  private _batchPut = async (resources:any[], backoffOpts:BackoffOptions) => {
    this._debug(`batchPut() ${resources.length} items`)

    const params:AWS.DynamoDB.BatchWriteItemInput = {
      RequestItems: {
        [this.name]: resources.map(Item => ({
          PutRequest: { Item }
        }))
      }
    }

    if (!params.ReturnConsumedCapacity) {
      params.ReturnConsumedCapacity = 'TOTAL'
    }

    const { backoff, maxTries } = backoffOpts
    const { docClient } = this.opts

    let tries = 0
    let start = Date.now()
    let time = 0
    let failed
    while (tries < maxTries) {
      this._debug('attempting batchWrite')
      let result = await docClient.batchWrite(params).promise()
      failed = result.UnprocessedItems
      if (!(failed && Object.keys(failed).length)) return

      this._debug(`batchPut partially failed, retrying`)
      params.RequestItems = failed
      await wait(backoff(tries++))
    }

    const err = new Error('batch put failed')
    err.failed = failed
    err.attempts = tries
    throw err

  }

  private _getPrimaryKeys = (resource) => {
    return pick(resource, this.primaryKeyProps)
  }

  private _getTPermalink = (resource):string => {
    return prefixString(resource._permalink, resource[TYPE])
  }

  // private _getPrimaryKeys = (props:string|any):KeyProps => {
  //   let hashKey, rangeKey
  //   if (typeof props === 'object') {
  //     hashKey = props[this.primaryKeys.hashKey]
  //     rangeKey = props[this.primaryKeys.rangeKey]
  //   } else {
  //     hashKey = props
  //   }

  //   return { hashKey, rangeKey }
  // }
}

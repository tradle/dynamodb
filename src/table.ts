import { EventEmitter } from 'events'
import dynogels = require('dynogels')
import { TYPE, SIG } from '@tradle/constants'
import BaseModels = require('@tradle/models')
import validateResource = require('@tradle/validate-resource')
import promisify = require('pify')
import {
  minifiedFlag,
  batchWriteLimit,
  defaultOrderBy,
  defaultIndexes,
  defaultPrimaryKeys,
  typeAndPermalinkProperty
} from './constants'

import {
  DynogelIndex,
  DynogelTableDefinition,
  KeyProps,
  ITableOpts,
  BackoffOptions,
  Objects,
  Model,
  Models,
  TableChooser,
  FindOpts,
  ReadOptions
} from './types'

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
  getTableName,
  getIndexForPrimaryKeys,
  getDefaultTableDefinition,
  getTableDefinitionForModel
} from './utils'

import minify from './minify'
import { NotFound } from './errors'
import filterDynamoDB from './filter-dynamodb'
import OPERATORS = require('./operators')
import {
  prefixKeys,
  unprefixKeys,
  prefixString,
  getUniquePrefix
} from './prefix'

import BaseObjectModel from './object-model'

// TODO: add this prop to tradle.Object

const DONT_PREFIX = Object.keys(BaseObjectModel.properties)

const defaultOpts = {
  maxItemSize: Infinity,
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

export default class Table extends EventEmitter {
  public name:string
  public models:Models
  public objects:Objects
  public model?:Model
  public primaryKeyProps:string[]
  public primaryKeys:KeyProps
  public indexes:DynogelIndex[]
  private opts:any
  private modelsStored:Models
  private _prefix:{[key:string]: string}
  private tableDefinition:DynogelTableDefinition
  private table:any
  private exclusive:boolean
  private readOnly:boolean
  private findOpts:object
  get hashKey() {
    return this.primaryKeys.hashKey
  }

  get rangeKey() {
    return this.primaryKeys.rangeKey
  }

  constructor (name, opts:ITableOpts) {
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
      readOnly,
      bodyInObjects,
      defaultReadOptions={},
      indexes,
      tableDefinition
    } = this.opts

    if (!models) throw new Error('expected "models"')
    if (bodyInObjects && !objects) throw new Error('expected "objects"')
    if (exclusive && !model) {
      throw new Error('expected "model" when "exclusive" is true')
    }

    this.name = name
    this.models = models
    this.objects = objects
    this.modelsStored = {}
    this.readOnly = readOnly
    this.exclusive = exclusive
    this.model = model
    this._prefix = {}
    if (exclusive) {
      this.modelsStored[model.id] = model
      this.primaryKeys = primaryKeys || model.primaryKeys
    } else {
      this.primaryKeys = defaultPrimaryKeys
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

    if (tableDefinition) {
      if (indexes) throw new Error('expected "tableDefinition" or "indexes" but not both')

      this.tableDefinition = tableDefinition
      this.indexes = tableDefinition.indexes
    } else {
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
    }

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
    model: Model,
    indexes?:DynogelIndex[]
  }) => {
    if (this.exclusive) {
      if (model.id === this.model.id) return

      throw new Error(`this table is exclusive to type: ${model.id}`)
    }

    if (!this.modelsStored[model.id]) {
      this.modelsStored[model.id] = model
      this._debug(`will store resources of model ${model.id}`)
    }

    if (!(indexes && indexes.length)) return

    if (this.opts.tableDefinition) {
      throw new Error(`can't add indexes to table with pre-defined "tableDefinition"`)
    }

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

    this.tableDefinition.indexes = this.indexes
    this._defineTable()
  }

  public get = async (query, opts={}):Promise<any> => {
    this._debug(`get() ${JSON.stringify(query)}`)
    query = this.toDBFormat(query)
    const keys = getValues(this.getPrimaryKeys(query))
    const result = await this.table.get(...keys, {
      ...this.opts.defaultReadOptions,
      ...opts
    })

    if (!result) {
      throw new NotFound(`query: ${JSON.stringify(query)}`)
    }

    const resource = await this._maybeInflate(this.fromDBFormat(result.toJSON()))
    return this._exportResource(resource)
  }

  public latest = async (query, opts={}):Promise<any> => {
    if (this.hashKey === typeAndPermalinkProperty) {
      return this.get(query, opts)
    }

    throw new Error(`only supported when hashKey is ${typeAndPermalinkProperty}`)
  }

  public del = async (query, opts={}):Promise<any> => {
    this._ensureWritable()

    query = this.toDBFormat(query)
    const keys = getValues(this.getPrimaryKeys(query))
    const result = await this.table.destroy(...keys, opts)
  }

  private _exportResource = resource => omit(resource, typeAndPermalinkProperty)

  public batchPut = async (
    resources:any[],
    backoffOpts=defaultBackoffOpts
  ) => {
    this._ensureWritable()

    const { maxItemSize } = this.opts
    resources.forEach(this._validateResource)

    const minified = resources.map(item => minify({
      table: this,
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

  public merge = async (resource):Promise<void> => {
    await this.update(resource)
  }

  public find = async (opts:FindOpts) => {
    opts = {
      ...this.findOpts,
      ...clone(opts),
      table: this
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
      await this.table.deleteTable()
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

  private _defineTable = () => {
    if (!this.tableDefinition) {
      this._debug('using default definition for table')
      if (this.exclusive) {
        const { models, model } = this
        this.tableDefinition = getTableDefinitionForModel({ models, model })
      } else {
        this.tableDefinition = getDefaultTableDefinition({
          tableName: this.name
        })
      }
    }

    const table = dynogels.define(this.name, this.tableDefinition)
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
    if (this.hashKey === typeAndPermalinkProperty) {
      resource = {
        ...resource,
        [typeAndPermalinkProperty]: this.calcTypeAndPermalinkProperty(resource)
      }
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
    this._ensureWritable()

    const type = resource[TYPE] || (this.exclusive && this.model.id)
    const model = this.modelsStored[type]
    if (!model) throw new Error(`model not found: ${type}`)

    let options
    let current
    if (this.hashKey === typeAndPermalinkProperty) {
      options = {
        ConditionExpression: 'attribute_not_exists(#tpermalink) OR #link = :link OR #time < :time',
        ExpressionAttributeNames: {
          '#time' : '_time',
          '#tpermalink': typeAndPermalinkProperty,
          '#link': '_link',
        },
        ExpressionAttributeValues: {
          ':time' : resource._time,
          ':link': resource._link
        }
      }
    }

    const { min, diff } = minify({
      table: this,
      item: resource,
      maxSize: this.opts.maxItemSize
    })

    const formatted = this.toDBFormat(min)
    const result = await this.table[method](formatted, options)
    const primaryKeys = this.getPrimaryKeys(formatted)
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
      const keys = JSON.stringify(this.getPrimaryKeys(resource))
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

  private getPrimaryKeys = (resource) => {
    const have = pick(resource, this.primaryKeyProps)
    if (this.hashKey === typeAndPermalinkProperty && !have._tpermalink) {
      have._tpermalink = this.calcTypeAndPermalinkProperty(resource)
    }

    return have
  }

  public calcTypeAndPermalinkProperty = (resource):string => {
    if (resource._tpermalink) return resource._tpermalink

    if (!(resource._permalink && resource[TYPE])) {
      throw new Error(`missing one of required props: _permalink, ${TYPE}`)
    }

    return prefixString(resource._permalink, resource[TYPE])
  }

  private _ensureWritable = () => {
    if (this.readOnly) {
      throw new Error('this table is read-only!')
    }
  }

  // private getPrimaryKeys = (props:string|any):KeyProps => {
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

export const createTable = (name, opts:ITableOpts) => {
  if (typeof name === 'object') {
    opts = name
    return new Table(opts.tableDefinition.tableName, opts)
  }

  new Table(name, opts)
}

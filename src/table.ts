import { EventEmitter } from 'events'
import _ = require('lodash')
import dynogels = require('dynogels')
import { TYPE, SIG } from '@tradle/constants'
import BaseModels = require('@tradle/models')
import validateResource = require('@tradle/validate-resource')
import promisify = require('pify')
import {
  minifiedFlag,
  batchWriteLimit,
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
  sha256,
  validateTableName,
  getFilterType,
  getTableName,
  getIndexForPrimaryKeys,
  getDefaultTableDefinition,
  getTableDefinitionForModel,
  toDynogelTableDefinition,
  getModelProperties
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
const HASH_AND_RANGE_KEYS = ['hashKey', 'rangeKey']

const defaultOpts = {
  maxItemSize: Infinity,
  requireSigned: true,
  forbidScan: false,
  validate: false,
  defaultReadOptions: {
    ConsistentRead: false
  }
}

const defaultBackoffOpts:BackoffOptions = {
  backoff: defaultBackoffFunction,
  maxTries: 6
}

export class Table extends EventEmitter {
  public name:string
  public models:Models
  public objects?:Objects
  public model?:Model
  public primaryKeyProps:string[]
  public primaryKeys:KeyProps
  public indexes:DynogelIndex[]
  public exclusive:boolean
  public table:any
  private opts:any
  private modelsStored:Models
  private _prefix:{[key:string]: string}
  private tableDefinition:DynogelTableDefinition
  private readOnly:boolean
  private findOpts:object
  get hashKey() {
    return this.primaryKeys.hashKey
  }

  get rangeKey() {
    return this.primaryKeys.rangeKey
  }

  constructor (opts:ITableOpts) {
    super()
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
      defaultReadOptions,
      tableDefinition
    } = this.opts

    if (!models) throw new Error('expected "models"')
    if (exclusive && !model) {
      throw new Error('expected "model" when "exclusive" is true')
    }

    this.tableDefinition = tableDefinition.TableName
      ? toDynogelTableDefinition(tableDefinition)
      : tableDefinition

    validateTableName(this.tableDefinition.tableName)
    this.name = this.tableDefinition.tableName
    this.models = models
    this.objects = objects
    this.modelsStored = {}
    this.readOnly = readOnly
    this.exclusive = exclusive
    this.model = model
    this._prefix = {}

    this.indexes = this.tableDefinition.indexes
    this.primaryKeys = _.pick(this.tableDefinition, HASH_AND_RANGE_KEYS)
    this.findOpts = {
      models,
      forbidScan,
      primaryKeys: this.primaryKeys,
      consistentRead: defaultReadOptions.consistentRead
    }

    this.primaryKeyProps = _.values(this.primaryKeys)

    if (exclusive) {
      this.addModel({ model })
    }

    this._initTable()
    this.on('def:update', () => this.table = null)
    this._debug('initialized')
  }

  public addModel = ({ model }: {
    model: Model
  }) => {
    if (this.exclusive) {
      if (model.id === this.model.id) {
        this.modelsStored[model.id] = model
        return
      }

      throw new Error(`this table is exclusive to type: ${model.id}`)
    }

    this.modelsStored[model.id] = model
    this._debug(`will store resources of model ${model.id}`)
  }

  public get = async (query, opts={}):Promise<any> => {
    this._debug(`get() ${JSON.stringify(query)}`)
    query = this.toDBFormat(query)
    const keys = _.values(this.getPrimaryKeys(query))
    const result = await this.table.get(...keys, {
      ...this.opts.defaultReadOptions,
      ...opts
    })

    if (!result) {
      throw new NotFound(`query: ${JSON.stringify(query)}`)
    }

    const resource = this.fromDBFormat(result)
    const cut = resource[minifiedFlag] || []
    if (this.objects && cut.length) {
      return this.objects.get(resource._link)
    }

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
    const keys = _.values(this.getPrimaryKeys(query))
    return await this.table.destroy(...keys, opts)
  }

  private _exportResource = resource => _.omit(resource, typeAndPermalinkProperty)

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

  public put = async (resource, opts?):Promise<void> => {
    this._debug(`put() ${resource[TYPE]}`)
    return await this._write('create', resource, opts)
  }

  public update = async (resource, opts?):Promise<any|void> => {
    this._debug(`update() ${resource[TYPE]}`)
    return await this._write('update', resource, opts)
  }

  public merge = async (resource, opts):Promise<any|void> => {
    return await this.update(resource, opts)
  }

  public find = async (opts:FindOpts):Promise<any> => {
    opts = {
      ...this.findOpts,
      ..._.cloneDeep(opts),
      table: this
    }

    // ensure type is set on filter
    getFilterType(opts)

    this._debug(`find() ${opts.filter.EQ[TYPE]}`)
    const results = await filterDynamoDB(opts)
    this._debug(`find returned ${results.items.length} results`)
    results.items = results.items.map(resource => this._exportResource(resource))
    return results
  }

  public findOne = async (opts):Promise<any> => {
    opts = { ...opts, limit: 1 }
    const { items=[] } = await this.find(opts)
    if (!items.length) {
      throw new NotFound(`query: ${JSON.stringify(opts)}`)
    }

    return items[0]
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

  private _initTable = () => {
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
    if (typeof resource.toJSON === 'function') {
      resource = resource.toJSON()
    }

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

  private _write = async (method:string, resource:any, options?:any):Promise<void> => {
    this._ensureWritable()

    const type = resource[TYPE] || (this.exclusive && this.model.id)
    const model = this.modelsStored[type]
    if (!model) throw new Error(`model not found: ${type}`)

    let current
    if (this.hashKey === typeAndPermalinkProperty) {
      if (!resource._link) {
        throw new Error('expected "_link"')
      }

      if (method === 'create' && !resource._time) {
        throw new Error('expected "_time"')
      }

      if (!options) {
        options = {
          ConditionExpression: 'attribute_not_exists(#tpermalink) OR #link = :link',
          ExpressionAttributeNames: {
            '#tpermalink': typeAndPermalinkProperty,
            '#link': '_link'
          },
          ExpressionAttributeValues: {
            ':link': resource._link
          }
        }

        if (resource._time) {
           options.ConditionExpression += ' OR #time < :time'
           options.ExpressionAttributeNames['#time'] = '_time'
           options.ExpressionAttributeValues[':time'] = resource._time
        }
      }
    }

    if (method === 'create') {
      const minified = minify({
        table: this,
        item: resource,
        maxSize: this.opts.maxItemSize
      })

      resource = minified.min
    }

    const formatted = this.toDBFormat(resource)
    const result = await this.table[method](formatted, options)
    // const { stack } = new Error('blah')
    // let result
    // try {
    //   result = await this.table[method](formatted, options)
    // } catch (err) {
    //   console.log(stack)
    //   debugger
    //   throw err
    // }

    const primaryKeys = this.getPrimaryKeys(formatted)
    this._debug(`"${method}" ${JSON.stringify(primaryKeys)} successfully`)
    return result
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
    const have = _.pick(resource, this.primaryKeyProps)
    if (this.hashKey === typeAndPermalinkProperty && !have[typeAndPermalinkProperty]) {
      have[typeAndPermalinkProperty] = this.calcTypeAndPermalinkProperty(resource)
    }

    return have
  }

  public calcTypeAndPermalinkProperty = (resource):string => {
    if (resource[typeAndPermalinkProperty]) return resource[typeAndPermalinkProperty]

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

export const createTable = (opts:ITableOpts) => new Table(opts)

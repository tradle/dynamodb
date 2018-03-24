import { EventEmitter } from 'events'
import _ from 'lodash'
import dynogels from 'dynogels'
import { TYPE, SIG } from '@tradle/constants'
import BaseModels from '@tradle/models'
import validateResource from '@tradle/validate-resource'
import { setVirtual } from '@tradle/build-resource'
import Errors from '@tradle/errors'
import promisify from 'pify'
import {
  minifiedFlag,
  batchWriteLimit,
  // typeAndPermalinkProperty
} from './constants'

import {
  IDynogelIndex,
  ITableDefinition,
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
  getTableDefinitionForModel,
  getModelProperties,
} from './utils'

import minify from './minify'
import { NotFound } from './errors'
import filterDynamoDB from './filter-dynamodb'
import OPERATORS = require('./operators')
import {
  // prefixKeys,
  // unprefixKeys,
  // prefixString,
} from './prefix'

import BaseObjectModel from './object-model'
import { PRIMARY_KEYS_PROPS } from './constants'

// TODO: add this prop to tradle.Object

const DONT_PREFIX = Object.keys(BaseObjectModel.properties)
const defaultOpts = {
  maxItemSize: Infinity,
  requireSigned: true,
  forbidScan: false,
  validate: false,
  defaultReadOptions: {
    consistentRead: false
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
  public keyProps:string[]
  public hashKeyProps:string[]
  public primaryKeys:KeyProps
  public derivedProperties: string[]
  public indexes:IDynogelIndex[]
  public exclusive:boolean
  public table:any
  private opts:ITableOpts
  private modelsStored:Models
  private _prefix:{[key:string]: string}
  private _latestIsSupported: boolean
  private tableDefinition:ITableDefinition
  private readOnly:boolean
  private findOpts:object
  private _deriveProperties:(item:any) => any
  private _resolveOrderBy?:(hashKey: string, property: string) => string
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
      requireSigned,
      forbidScan,
      readOnly,
      defaultReadOptions,
      tableDefinition,
      deriveProperties=_.stubObject,
      derivedProperties=[],
      resolveOrderBy
    } = this.opts

    if (!models) throw new Error('expected "models"')
    if (exclusive && !model) {
      throw new Error('expected "model" when "exclusive" is true')
    }

    // @ts-ignore
    this.tableDefinition = tableDefinition.TableName ? toDynogelTableDefinition(tableDefinition) : tableDefinition

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
    this.primaryKeys = _.pick(this.tableDefinition, PRIMARY_KEYS_PROPS)
    this._deriveProperties = deriveProperties
    this.derivedProperties = derivedProperties
    this._resolveOrderBy = resolveOrderBy
    this._latestIsSupported = !!this.deriveProperties({
      [TYPE]: 'a',
      _permalink: 'b'
    })[this.hashKey]

    this.findOpts = {
      models,
      forbidScan,
      primaryKeys: this.primaryKeys,
      consistentRead: defaultReadOptions.consistentRead
    }

    this.primaryKeyProps = _.values(this.primaryKeys)
    this.hashKeyProps = _.uniq([this.hashKey].concat(this.indexes.map(index => index.hashKey)))
    this.keyProps = _.uniq(this.primaryKeyProps.concat(
      _.flatMap(this.indexes, index => _.values(_.pick(index, PRIMARY_KEYS_PROPS)))
    ))

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
    const expandedQuery = this.toDBFormat(query)
    const keysObj = this.getPrimaryKeys(expandedQuery)

    let result
    if (this._hasAllPrimaryKeys(keysObj)) {
      const keys = _.values(keysObj)
      result = await this.table.get(...keys, {
        ...this.opts.defaultReadOptions,
        ...opts
      })
    } else {
      result = await this.findOne({
        orderBy: {
          property: this.rangeKey,
          desc: false
        },
        filter: {
          EQ: query
        }
      })
    }

    if (!result) {
      throw new NotFound(`query: ${JSON.stringify(query)}`)
    }

    const resource = this.fromDBFormat(result)
    const cut = resource[minifiedFlag] || []
    if (this.objects && cut.length) {
      return this.objects.get(resource._link)
    }

    return resource
  }

  public latest = async (query, opts={}):Promise<any> => {
    if (this._latestIsSupported) {
      return this.get(query, opts)
    }

    throw new Error(`only supported when hashKey value is derived from type and permalink`)
  }

  public del = async (query, opts={}):Promise<any> => {
    this._ensureWritable()

    query = this.toDBFormat(query)
    const keys = _.values(this.getPrimaryKeys(query))
    return await this.table.destroy(...keys, opts)
  }

  private _exportResource = resource => this.omitDerivedProperties(resource)

  public batchPut = async (
    resources:any[],
    backoffOpts=defaultBackoffOpts
  ) => {
    this._ensureWritable()

    const { maxItemSize } = this.opts
    resources.forEach(this._validateResource)
    resources = resources.map(this.withDerivedProperties)

    const minified = resources.map(item => minify({
      table: this,
      item,
      maxSize: maxItemSize
    }))

    // let mins = minified.map(({ min }) => this.toDBFormat(min))
    let mins = minified.map(({ min }) => min)
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

  public search = opts => this.find(opts)

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
      Errors.ignore(err, { code: 'ResourceInUseException' })
    }

    this._debug('created table')
  }

  public destroy = async ():Promise<void> => {
    this._debug('destroy() table')
    try {
      await this.table.deleteTable()
    } catch (err) {
      Errors.ignore(err, { code: 'ResourceNotFoundException' })
    }

    this._debug('destroyed table')
  }

  private _debug = (...args):void => {
    args.unshift(this.name)
    debug(...args)
  }

  private _initTable = () => {
    const table = dynogels.define(this.name, _.omit(this.tableDefinition, ['defaultReadOptions', 'primaryKeys']))
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

  public deriveProperties = resource => {
    return _.omitBy(this._deriveProperties(resource), prop => prop in resource)
  }

  public toDBFormat = resource => this.withDerivedProperties(resource)

  // public toDBFormat = (resource) => {
  //   if (this.hashKey === typeAndPermalinkProperty) {
  //     resource = {
  //       ...resource,
  //       [typeAndPermalinkProperty]: this.calcTypeAndPermalinkProperty(resource)
  //     }
  //   }

  //   return this.prefixProperties(resource)
  // }

  public fromDBFormat = (resource) => {
    if (typeof resource.toJSON === 'function') {
      resource = resource.toJSON()
    }

    return this._exportResource(resource)
    // return this.unprefixProperties(resource)
  }

  // public prefixKey = ({ type, key }: { type:string, key:string }):string => {
  //   return DONT_PREFIX.includes(key)
  //     ? key
  //     : prefixString(key, this.getPrefix(type))
  // }

  // public prefixProperties = function (resource) {
  //   return this.prefixPropertiesForType(resource[TYPE], resource)
  // }

  // public prefixPropertiesForType = function (type:string, properties:any) {
  //   return this.exclusive
  //     ? properties
  //     : prefixKeys(properties, this.getPrefix(type), DONT_PREFIX)
  // }

  // public unprefixProperties = function (resource) {
  //   return this.unprefixPropertiesForType(resource[TYPE], resource)
  // }

  // public unprefixPropertiesForType = function (type:string, resource:any) {
  //   return this.exclusive
  //     ? resource
  //     : unprefixKeys(resource, this.getPrefix(type), DONT_PREFIX)
  // }

  // public prefixPropertyNamesForType = function (type: string, props: string[]) {
  //   return this.exclusive ? props : props.map(prop => prefixString(prop, this.getPrefix(type)))
  // }

  private _write = async (method:string, resource:any, options?:any):Promise<void> => {
    this._ensureWritable()

    const type = resource[TYPE] || (this.exclusive && this.model.id)
    const model = this.modelsStored[type]
    if (!model) throw new Error(`model not found: ${type}`)

    resource = this.toDBFormat(resource)
    if (method === 'update' && !this._hasAllPrimaryKeys(resource)) {
      throw new Error('update requires values for all primary keys')
    }

    let current
    if (this._latestIsSupported) {
      if (!resource._link) {
        throw new Error('expected "_link"')
      }

      if (method === 'create' && !resource._time) {
        throw new Error('expected "_time"')
      }

      if (!options) {
        options = {
          ConditionExpression: Object.keys(this.primaryKeys)
            .map(keyType => `attribute_not_exists(#${keyType})`)
            .join(' and '),
          ExpressionAttributeNames: Object.keys(this.primaryKeys)
            .reduce((names, keyType) => {
              names[`#${keyType}`] = this.primaryKeys[keyType]
              return names
            }, {}),
          ExpressionAttributeValues: {
            ':link': resource._link
          }
        }

        options.ConditionExpression = `(${options.ConditionExpression}) OR #link = :link`
        options.ExpressionAttributeNames['#link'] = '_link'
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

    let result
    try {
      result = await this.table[method](resource, options)
    } catch (err) {
      Errors.rethrow(err, 'developer')
      err.input = { item: resource, options }
      throw err
    }

    const primaryKeys = this.getPrimaryKeys(resource)
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

    const err:any = new Error('batch put failed')
    err.failed = failed
    err.attempts = tries
    throw err

  }

  public getPrimaryKeys = resource => _.pick(this.withDerivedProperties(resource), this.primaryKeyProps)

  // private getPrimaryKeys = (resource) => {
  //   const have = _.pick(resource, this.primaryKeyProps)
  //   if (this.hashKey === typeAndPermalinkProperty && !have[typeAndPermalinkProperty]) {
  //     have[typeAndPermalinkProperty] = this.calcTypeAndPermalinkProperty(resource)
  //   }

  //   return have
  // }

  // public calcTypeAndPermalinkProperty = (resource):string => {
  //   if (resource[typeAndPermalinkProperty]) return resource[typeAndPermalinkProperty]

  //   if (!(resource._permalink && resource[TYPE])) {
  //     throw new Error(`missing one of required props: _permalink, ${TYPE}`)
  //   }

  //   return prefixString(resource._permalink, resource[TYPE])
  // }

  public addDerivedProperties = resource => _.extend(
    resource,
    this.deriveProperties(resource)
  )

  public withDerivedProperties = resource => _.extend({}, resource, this.deriveProperties(resource))
  public omitDerivedProperties = resource => _.omit(resource, this.derivedProperties)

  public resolveOrderBy = (hashKey: string, property: string) => {
    if (this._resolveOrderBy) {
      return this._resolveOrderBy(hashKey, property) || property
    }

    return property
  }

  private _ensureWritable = () => {
    if (this.readOnly) {
      throw new Error('this table is read-only!')
    }
  }

  private _hasAllPrimaryKeys = obj => _.size(this.getPrimaryKeys(obj)) === this.primaryKeyProps.length

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

import { EventEmitter } from 'events'
import _ from 'lodash'
import dynogels from 'dynogels'
import { TYPE, SIG } from '@tradle/constants'
import BaseModels from '@tradle/models'
import validateResource from '@tradle/validate-resource'
import Errors from '@tradle/errors'
import createHooks from 'event-hooks'
import promisify from 'pify'
import {
  minifiedFlag,
  batchWriteLimit,
  RANGE_KEY_PLACEHOLDER_VALUE
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
  ReadOptions,
  ResolveOrderBy,
  ResolveOrderByInput,
  PropsDeriver,
  PropsDeriverInput,
  DerivedPropsParser,
  GetIndexesForModel,
  GetPrimaryKeysForModel,
  ShouldMinify,
  ILogger,
  SearchResult,
  ReindexOpts,
  OrderBy
} from './types'

import * as utils from './utils'
const {
  wait,
  defaultBackoffFunction,
  sha256,
  validateTableName,
  getFilterType,
  getTableName,
  getTableDefinitionForModel,
  getModelProperties,
  hookUp,
  resultsToJson,
  normalizeIndexedPropertyTemplateSchema,
  normalizeIndexedProperty,
  toDynogelTableDefinition,
  pickNonNull
} = utils

import * as defaults from './defaults'
import minify from './minify'
import { NotFound, InvalidInput } from './errors'
import { Search } from './search'
import OPERATORS = require('./operators')
import { PRIMARY_KEYS_PROPS } from './constants'

const defaultOpts = {
  maxItemSize: Infinity,
  allowScan: true,
  validate: false,
  defaultReadOptions: {
    consistentRead: false
  }
}

const defaultBackoffOpts:BackoffOptions = {
  backoff: defaultBackoffFunction,
  maxTries: 6
}

const HOOKABLE = [
  'put',
  'update',
  'merge',
  'get',
  'del',
  'batchPut',
  'find',
  'findOne',
  'create',
  'destroy'
]

type ResolveOrderByInputLite = {
  type: string
  hashKey: string
  property: string
  item?: any
  table?: Table
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
  public derivedProps: string[]
  public parseDerivedProps: DerivedPropsParser
  public indexes:IDynogelIndex[]
  public indexed:IDynogelIndex[]
  public exclusive:boolean
  public table:any
  public logger: ILogger
  private opts:ITableOpts
  private modelsStored:Models
  private _prefix:{[key:string]: string}
  private tableDefinition:ITableDefinition
  private readOnly:boolean
  private findOpts:object
  private _deriveProps:PropsDeriver
  private _resolveOrderBy:ResolveOrderBy
  private _getIndexesForModel:GetIndexesForModel
  private _getPrimaryKeysForModel:GetPrimaryKeysForModel
  private _shouldMinify: ShouldMinify
  private hooks: any
  get hashKey() {
    return this.primaryKeys.hashKey
  }

  get rangeKey() {
    return this.primaryKeys.rangeKey
  }

  constructor (opts:ITableOpts) {
    super()

    const table = this

    this.opts = { ...defaultOpts, ...opts }
    const {
      models,
      model,
      modelsStored={},
      objects,
      exclusive,
      allowScan,
      readOnly,
      defaultReadOptions,
      tableDefinition,
      derivedProps=[],
      deriveProps=utils.deriveProps,
      resolveOrderBy=utils.resolveOrderBy,
      getIndexesForModel=utils.getIndexesForModel,
      getPrimaryKeysForModel=utils.getPrimaryKeysForModel,
      parseDerivedProps=utils.parseDerivedProps,
      shouldMinify=_.stubTrue,
      logger=defaults.logger,
    } = this.opts

    if (!models) throw new Error('expected "models"')
    if (exclusive && !model) {
      throw new Error('expected "model" when "exclusive" is true')
    }

    this.logger = logger

    // @ts-ignore
    this.tableDefinition = tableDefinition.TableName ? toDynogelTableDefinition(tableDefinition) : tableDefinition

    validateTableName(this.tableDefinition.tableName)
    this.name = this.tableDefinition.tableName
    this.models = _.clone(models)
    this.objects = objects
    this.modelsStored = modelsStored
    this.readOnly = readOnly
    this.exclusive = exclusive
    this.model = model
    this._prefix = {}

    this.primaryKeys = pickNonNull(this.tableDefinition, PRIMARY_KEYS_PROPS)
    this.indexes = this.tableDefinition.indexes || []
    this.indexed = this.indexes.slice()
    this.indexed.unshift({
      type: 'global',
      name: '_',
      projection: {
        ProjectionType: 'ALL'
      },
      ...this.primaryKeys
    })

    this._deriveProps = deriveProps
    this.derivedProps = derivedProps
    this.parseDerivedProps = parseDerivedProps
    this._resolveOrderBy = resolveOrderBy
    this._getIndexesForModel = getIndexesForModel
    this._getPrimaryKeysForModel = getPrimaryKeysForModel
    this._shouldMinify = shouldMinify
    this.findOpts = {
      // may change dynamically
      get models() { return table.models },
      allowScan,
      primaryKeys: this.primaryKeys,
      consistentRead: defaultReadOptions.consistentRead
    }

    this.primaryKeyProps = _.values(this.primaryKeys)
    this.hashKeyProps = _.uniq(this.indexed.map(i => i.hashKey))
    this.keyProps = _.uniq(_.flatMap(this.indexed, index => _.values(_.pick(index, PRIMARY_KEYS_PROPS))))
    if (exclusive) {
      this.storeResourcesForModel({ model })
    }

    this._initTable()
    this.on('def:update', () => this.table = null)
    this.logger.silly('initialized')
    this.hooks = createHooks()
    HOOKABLE.forEach(method => {
      this[method] = hookUp(this[method].bind(this), method)
    })
  }

  public getKeyTemplate = (model: Model, key: string) => {
    const keyIdx = this.keyProps.indexOf(key)
    return _.flatMap(this.getKeyTemplatesForModel(model), ({ hashKey, rangeKey }) => {
      return rangeKey ? [hashKey, rangeKey] : hashKey
    })[keyIdx]
  }

  public getKeyTemplatesForModel = (model: Model) => {
    if (!model) {
      throw new Error('expected "model"')
    }

    const raw = [
      this._getPrimaryKeysForModel({ table: this, model }),
      ...this._getIndexesForModel({ table: this, model })
    ]
    .map(normalizeIndexedPropertyTemplateSchema)

    if (raw.length > this.indexed.length) {
      console.warn(`more key templates than indexes for model: ${model.id}!`)
    }

    return raw.slice(0, this.indexed.length).map((indexedProp, i) => {
      return {
        ...indexedProp,
        hashKey: {
          ...indexedProp.hashKey,
          key: this.indexed[i].hashKey
        },
        rangeKey: indexedProp.rangeKey && {
          ...indexedProp.rangeKey,
          key: this.indexed[i].rangeKey
        }
      }
    })
  }

  public hook = (method, handler) => this.hooks.hook(method, handler)

  public storeResourcesForModels = (models: Models) => _.each(models, model => this.storeResourcesForModel({ model }))

  public storeResourcesForModel = ({ model }: {
    model: Model
  }) => {
    if (this.exclusive) {
      if (model.id === this.model.id) {
        this.modelsStored[model.id] = model
        return
      }

      throw new Error(`this table is exclusive to type: ${model.id}`)
    }

    if (!this.modelsStored[model.id]) {
      this.logger.silly(`will store resources of model ${model.id}`)
    }

    this.modelsStored[model.id] = model
    if (!this.models[model.id]) {
      this.models[model.id] = model
    }
  }

  public get = async (query, opts:any={}):Promise<any> => {
    this.logger.silly(`get() ${JSON.stringify(query)}`)
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
      // try to fall back to index
      //
      // hmm...rethink this? dynamodb indexes apparently don't enforce uniqueness
      // so this get() isn't really a get, it's more of a findOne
      const index = this.indexes.find(index => this._hasAllKeys(expandedQuery, index))
      if (!index) {
        throw new Error('expected primary keys or keys for an indexed property')
      }

      result = await this.findOne({
        orderBy: {
          property: index.rangeKey
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

    return this._exportResource(resource, opts)
  }

  public del = async (query, opts:any={}):Promise<any> => {
    this._ensureWritable()

    query = this.toDBFormat(query)
    const keys = _.values(this.getPrimaryKeys(query))
    const result = await this.table.destroy(...keys, opts)
    return result && this._exportResource(result, opts)
  }

  private _exportResource = (resource:any, opts:any={}) => {
    resource = this.fromDBFormat(resource)
    if (!opts.keepDerivedProps) {
      resource = this.omitDerivedProperties(resource)
    }

    return resource
  }

  public batchPut = async (
    resources:any[],
    backoffOpts=defaultBackoffOpts
  ) => {
    this._ensureWritable()

    resources = resources.map(this.withDerivedProperties)
    resources.forEach(this._ensureHasPrimaryKeys)
    resources.forEach(this._validateResource)

    const minified = resources.map(this._minify)

    // let mins = minified.map(({ min }) => this.toDBFormat(min))
    let mins = minified.map(({ min }) => min)
    let batch
    while (mins.length) {
      batch = mins.slice(0, batchWriteLimit)
      mins = mins.slice(batchWriteLimit)
      await this._batchPut(batch, backoffOpts)
      this.logger.silly(`batchPut ${batch.length} items successfully`)
    }

    return resources
  }

  public put = async (resource, opts?):Promise<void> => {
    this.logger.silly(`put() ${resource[TYPE]}`)
    this._validateResource(resource)
    return await this._write('create', resource, opts)
  }

  public update = async (resource, opts?):Promise<any|void> => {
    this.logger.silly(`update() ${resource[TYPE]}`)
    return await this._write('update', resource, opts)
  }

  public merge = async (resource, opts):Promise<any|void> => {
    return await this.update(resource, opts)
  }

  public find = async (opts:FindOpts):Promise<SearchResult> => {
    opts = {
      ...this.findOpts,
      ..._.cloneDeep(opts),
      table: this
    }

    // ensure type is set on filter
    getFilterType(opts)

    this.logger.silly(`find() ${opts.filter.EQ[TYPE]}`)
    const op = new Search(opts)
    await this.hooks.fire('pre:find:validate', op)
    let results
    try {
      results = await op.exec()
    } catch (err) {
      if (err.code === 'ValidationException') {
        this.logger.error('request failed validation', err.request)
      }

      throw err
    }

    this.logger.silly(`find returned ${results.items.length} results`)
    results.items = results.items.map(resource => this._exportResource(resource, opts))
    return results
  }

  public findOne = async (opts:FindOpts) => {
    opts = { ...opts, limit: 1 }
    const { items=[] } = await this.find(opts)
    if (!items.length) {
      throw new NotFound(`query: ${JSON.stringify(opts)}`)
    }

    return items[0]
  }

  public search = (opts:FindOpts):Promise<SearchResult> => this.find(opts)
  public list = async (type: string, opts:Partial<FindOpts>={}):Promise<SearchResult> => this.find(_.merge({
    filter: {
      EQ: {
        [TYPE]: type
      }
    }
  }, opts))

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
    this.logger.info('creating table')
    try {
      await this.table.createTable()
    } catch (err) {
      Errors.ignore(err, { code: 'ResourceInUseException' })
    }

    this.logger.silly('created table')
  }

  public destroy = async ():Promise<void> => {
    this.logger.info('destroying table')
    try {
      await this.table.deleteTable()
    } catch (err) {
      Errors.ignore(err, { code: 'ResourceNotFoundException' })
    }

    this.logger.silly('destroyed table')
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

  public deriveProps = (opts: {
    item: any
    isRead?: boolean
    noConstants?: boolean
  }) => {
    const { item } = opts
    const derived = this._deriveProps({ table: this, isRead: false, ...opts })
    return _.omitBy(derived, (value, prop) => prop in item || value == null)
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

  public fromDBFormat = resultsToJson

    // return this._exportResource(resource)
    // return this.unprefixProperties(resource)

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

  private _write = async (method:string, resource:any, options:any={}):Promise<void> => {
    this._ensureWritable()

    const type = resource[TYPE] || (this.exclusive && this.model.id)
    const model = this.modelsStored[type]
    if (!model) throw new Error(`model not found: ${type}`)

    resource = this.toDBFormat(resource)
    this._ensureHasPrimaryKeys(resource)

    if (method === 'create') {
      const minified = this._minify(resource)
      resource = minified.min
    } else if (options && options.diff) {
      const { diff } = options
      validateDiff(diff)
      options = {
        ...utils.createUpdateOptionsFromDiff(diff),
        ..._.omit(options, ['diff'])
      }

      resource = this.getPrimaryKeys(resource)
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
    this.logger.silly(`"${method}" ${JSON.stringify(primaryKeys)} successfully`)
    return result && this._exportResource(result, options)
  }

  private _validateResource = (resource) => {
    const { models, modelsStored } = this
    const type = resource[TYPE]
    const model = models[type]
    if (!model) {
      throw new Error(`missing model ${type}`)
    }

    if (this.opts.validate) {
      validateResource({ models, model, resource })
    }
  }

  private _batchPut = async (resources:any[], backoffOpts:BackoffOptions) => {
    this.logger.silly(`batchPut() ${resources.length} items`)

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
      this.logger.silly('attempting batchWrite')
      let result = await docClient.batchWrite(params).promise()
      failed = result.UnprocessedItems
      if (!(failed && Object.keys(failed).length)) return

      this.logger.debug(`batchPut partially failed, retrying`)
      params.RequestItems = failed
      await wait(backoff(tries++))
    }

    const err:any = new Error('batch put failed')
    err.failed = failed
    err.attempts = tries
    throw err

  }

  public getPrimaryKeys = resource => this.getKeys(resource, this.primaryKeys)
  public getKeys = (resource, schema:KeyProps) => {
    return _.pick(resource, getKeyProps(schema))
  }

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

  public addDerivedProperties = (item, isRead) => _.extend(
    item,
    this.deriveProps({ item, isRead })
  )

  public withDerivedProperties = item => _.extend({}, item, this.deriveProps({ item }))
  public omitDerivedProperties = item => _.omit(item, this.derivedProps)

  public resolveOrderBy = (opts: ResolveOrderByInputLite) => {
    return this._resolveOrderBy({ table: this, ...opts })
  }

  public reindex = async ({ model, batchSize=50, findOpts={} }: ReindexOpts) => {
    const table = this
    const { indexes } = model
    if (indexes) {
      const hasType = indexes
        .map(normalizeIndexedProperty)
        .some(i => i.hashKey === '_t')

      if (!hasType) throw new Errors.InvalidInput('model is not indexed by type')
    }

    let checkpoint
    let updated = 0
    let unchanged = 0
    const limit = batchSize
    while (true) {
      let { items, endPosition } = await table.find(_.merge({
        limit,
        filter: {
          EQ: {
            _t: model.id
          }
        },
        checkpoint
      }, findOpts))

      if (!items.length) break

      checkpoint = endPosition
      let changed = items.filter(item => table.haveIndexedPropsChanged(item))
      unchanged += (items.length - changed.length)
      // force re-index
      if (changed.length) {
        await table.batchPut(changed)
        updated += changed.length
      }

      if (items.length < limit) break
    }

    return {
      updated,
      unchanged
    }
  }

  public haveIndexedPropsChanged = item => {
    const recalced = this.withDerivedProperties(this.omitDerivedProperties(item))
    const before = _.pick(item, this.keyProps)
    const after = _.pick(recalced, this.keyProps)
    return !_.isEqual(before, after)
  }

  private _ensureWritable = () => {
    if (this.readOnly) {
      throw new Error('this table is read-only!')
    }
  }

  private _ensureHasPrimaryKeys = (resource) => {
    if (!this._hasAllPrimaryKeys(resource)) {
      throw new Error('expected values for all primary keys')
    }
  }

  private _hasAllPrimaryKeys = obj => this._hasAllKeys(obj, this.primaryKeys)

  private _hasAllKeys = (obj, schema:KeyProps) => {
    return _.size(this.getKeys(obj, schema)) === _.size(getKeyProps(schema))
  }

  private _minify = (item: any) => {
    if (this._shouldMinify(item)) {
      return minify({
        table: this,
        item,
        maxSize: this.opts.maxItemSize
      })
    }

    return {
      min: item,
      diff: {}
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

const getKeyProps = (schema: KeyProps) => _.values(pickNonNull(schema, PRIMARY_KEYS_PROPS))

const DIFF_OPS = ['add', 'remove', 'replace']
const validateDiff = diff => {
  if (!Array.isArray(diff)) {
    throw new InvalidInput(`expected diff to be array of diff items`)
  }

  diff.forEach(validateDiffItem)
}

const validateDiffItem = ({ op, path, value }) => {
  if (!DIFF_OPS.includes(op)) {
    throw new InvalidInput(`invalid diff op: ${op}`)
  }

  if (!(Array.isArray(path) && path.every(sub => typeof sub === 'string'))) {
    throw new InvalidInput(`invalid diff path, expected string array: ${JSON.stringify(path)}`)
  }
}

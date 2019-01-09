import { EventEmitter } from 'events'
import _ = require('lodash')
import { TYPE } from '@tradle/constants'
import createHooks from 'event-hooks'
import {
  minBy,
  sha256,
  getTableName,
  validateTableName,
  getFilterType,
  lazyDefine,
  levenshteinDistance,
  hookUp
} from './utils'

import { Table } from './table'
import { ModelStore } from './model-store'
import {
  IDBOpts,
  ITableOpts,
  IDynogelIndex,
  Model,
  Models,
  TableChooser,
  FindOpts,
  ILogger,
  SearchResult,
  ReindexOpts,
} from './types'

import * as defaults from './defaults'

const HOOKABLE = [
  'put',
  'update',
  'merge',
  'get',
  'del',
  'batchPut',
  'find',
  'findOne',
  'createTable',
  'destroyTable'
]

const defaultTableChooser:TableChooser = ({
  tables,
  type
}) => {
  return minBy(
    tables,
    (table, i) => levenshteinDistance(sha256(type), sha256(table.name))
  )
}

export default class DB extends EventEmitter {
  public static getSafeTableName = model => getTableName({ model })
  public modelStore: ModelStore
  // table bucket name => bucket
  public tablesByName:{ [key:string]: Table }
  // tables by type (model.id)
  public tables:{ [key:string]: Table }
  public exclusive: { [key:string]: Table }
  public logger: ILogger
  private tableTableNames: string[]
  private _choose:TableChooser
  private _instantiateTable:(name:string) => Table
  private hooks: any
  constructor ({
    tableNames,
    defineTable,
    chooseTable=defaultTableChooser,
    modelStore,
    logger=defaults.logger
  }: IDBOpts) {
    super()
    this.logger = logger

    if (!(modelStore &&
      Array.isArray(tableNames) &&
      typeof defineTable === 'function' &&
      typeof chooseTable === 'function')) {
      throw new Error('missing required parameter')
    }

    this.modelStore = modelStore
    this.modelStore.on('invalidate:model', ({ id }) => {
      delete this.tables[id]
    })

    tableNames.forEach(validateTableName)

    this.tableTableNames = tableNames
    this.exclusive = {}
    this._choose = chooseTable
    this._instantiateTable = defineTable
    this.tables = {}
    this.tablesByName = {}
    lazyDefine(
      this.tablesByName,
      this.tableTableNames,
      this._instantiateTable
    )

    for (let id in this.exclusive) {
      let table = this.exclusive[id]
      this.tables[table.model.id] = table
      this.tablesByName[table.name] = table
    }

    this.hooks = createHooks()
    HOOKABLE.forEach(method => {
      this[method] = hookUp(this[method].bind(this), method)
    })
  }

  public get models():Models {
    return this.modelStore.models
  }

  public setExclusive = ({ model, table }: {
    model?: any,
    table: Table
  }):void => {
    if (!table) throw new Error('expected "table"')
    if (!model) model = table.model
    if (!model) throw new Error('expected "model"')

    this.tablesByName[model.id] = table
    this.tables[model.id] = table
    this.exclusive[model.id] = table
  }

  public choose = async (type:string):Promise<Table> => {
    const model = await this.modelStore.get(type)
    return this._chooseTableForModel(model)
  }

  public put = async (resource, opts?) => {
    const table = await this.getTableForType(resource[TYPE])
    return await table.put(resource, opts)
  }

  public update = async (resource, opts?) => {
    const table = await this.getTableForType(resource[TYPE])
    return await table.update(resource, opts)
  }

  public merge = async (resource, opts?) => {
    const table = await this.getTableForType(resource[TYPE])
    return await table.merge(resource, opts)
  }

  public get = async (keys:any, opts?) => {
    const table = await this.getTableForType(keys[TYPE])
    return await table.get(keys, opts)
  }

  public del = async (keys:any, opts?) => {
    const table = await this.getTableForType(keys[TYPE])
    return await table.del(keys, opts)
  }

  public getTableForType = async (type:string):Promise<Table> => {
    return this.tables[type] || this.choose(type)
  }

  public getTableForModel = (model:Model):Table => {
    return this.tables[model.id] || this._chooseTableForModel(model)
  }

  public batchPut = async (resources:any[], opts?):Promise<any[]|void> => {
    const byTable = new Map<Table, any[]>()
    // prime cache
    resources.forEach(resource => this.getTableForType(resource[TYPE]))
    const byType = _.groupBy(resources, TYPE)
    const results = await Promise.all(_.map(byType, async (batch, type) => {
      const table = await this.getTableForType(type)
      return table.batchPut(batch, opts)
    }))

    return _.flatten(results)
  }

  public find = async (opts:FindOpts):Promise<SearchResult> => {
    const type = getFilterType(opts)
    const table = await this.getTableForType(type)
    return await table.find(opts)
  }

  public findOne = async (opts) => {
    const type = getFilterType(opts)
    const table = await this.getTableForType(type)
    return await table.findOne(opts)
  }

  public search = (opts):Promise<SearchResult> => this.find(opts)
  public list = async (type: string, opts?:Partial<FindOpts>):Promise<SearchResult> => {
    const table = await this.getTableForType(type)
    return await table.list(type, opts)
  }

  public reindex = async (opts: ReindexOpts) => {
    const table = this.getTableForModel(opts.model)
    return await table.reindex(opts)
  }

  public createTables = async ():Promise<void> => {
    for (const name of this._getTablesNames()) {
      await this.createTable(name)
    }
  }

  public destroyTables = async ():Promise<void> => {
    for (const name of this._getTablesNames()) {
      await this.tablesByName[name].destroy()
    }
  }

  public hook = (method, handler) => this.hooks.hook(method, handler)

  // public hasTableForModel = (model:any|string) => {
  //   const id = typeof model === 'string' ? model : model.id
  //   return !!this.tables[id]
  // }

  private createTable = async (name: string) => {
    await this.tablesByName[name].create()
  }

  private destroyTable = async (name: string) => {
    await this.tablesByName[name].destroy()
  }

  private _getTablesNames = ():string[] => {
    return this.tableTableNames.concat(Object.keys(this.exclusive))
  }

  private _chooseTableForModel = (model: Model) => {
    const type = model.id
    const table = this._choose({
      tables: this.tableTableNames.map(name => this.tablesByName[name]),
      type
    })

    if (!table) {
      throw new Error(`table not found for type ${type}`)
    }

    // save alias
    this.tables[type] = table
    table.storeResourcesForModel({
      model: this.models[type]
    })

    return table
  }
}

export const createDB = (opts: IDBOpts) => new DB(opts)

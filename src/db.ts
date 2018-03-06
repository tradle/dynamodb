import { EventEmitter } from 'events'
import _ = require('lodash')
import validateResource = require('@tradle/validate-resource')
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
} from './utils'

import { Table } from './table'
import { ModelStore } from './model-store'
import { IDBOpts, ITableOpts, DynogelIndex, Model, Models, TableChooser, FindOpts } from './types'

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
  private tableTableNames: string[]
  private _choose:TableChooser
  private _instantiateTable:(name:string) => Table
  private hooks: any
  constructor ({
    tableNames,
    defineTable,
    chooseTable=defaultTableChooser,
    modelStore
  }: IDBOpts) {
    super()

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
    const table = this._choose({
      tables: this.tableTableNames.map(name => this.tablesByName[name]),
      type
    })

    if (!table) {
      throw new Error(`table not found for type ${type}`)
    }

    // save alias
    this.tables[type] = table
    table.addModel({
      model: this.models[type]
    })

    return table
  }

  public put = async (resource, opts?) => {
    await this.hooks.fire('put', { resource, opts })
    const table = await this.getTableForModel(resource[TYPE])
    return await table.put(resource, opts)
  }

  public update = async (resource, opts?) => {
    await this.hooks.fire('update', { resource, opts })
    const table = await this.getTableForModel(resource[TYPE])
    return await table.update(resource, opts)
  }

  public merge = async (resource, opts?) => {
    await this.hooks.fire('merge', { resource, opts })
    const table = await this.getTableForModel(resource[TYPE])
    return await table.merge(resource, opts)
  }

  public get = async (keys:any, opts?) => {
    await this.hooks.fire('get', { keys, opts })
    const table = await this.getTableForModel(keys[TYPE])
    return await table.get(keys, opts)
  }

  public latest = async (keys:any, opts?) => {
    await this.hooks.fire('latest', { keys, opts })
    const table = await this.getTableForModel(keys[TYPE])
    return await table.latest(keys, opts)
  }

  public del = async (keys:any) => {
    await this.hooks.fire('del', { keys })
    const table = await this.getTableForModel(keys[TYPE])
    await table.del(keys)
  }

  public getTableForModel = async (model:string|Model):Promise<Table> => {
    const type:string = typeof model === 'string' ? model : model.id
    return this.tables[type] || this.choose(type)
  }

  public batchPut = async (resources:any[], opts?):Promise<any[]|void> => {
    await this.hooks.fire('batchPut', { resources, opts })
    const byTable = new Map<Table, any[]>()
    // prime cache
    resources.forEach(resource => this.getTableForModel(resource[TYPE]))
    const byType = _.groupBy(resources, TYPE)
    const results = await Promise.all(_.map(byType, async (batch, type) => {
      const table = await this.getTableForModel(type)
      return table.batchPut(batch, opts)
    }))

    return _.flatten(results)
  }

  public find = async (opts:FindOpts) => {
    await this.hooks.fire('find', opts)
    const type = getFilterType(opts)
    const table = await this.getTableForModel(type)
    return await table.find(opts)
  }

  public findOne = async (opts) => {
    await this.hooks.fire('findOne', opts)
    const type = getFilterType(opts)
    const table = await this.getTableForModel(type)
    return await table.findOne(opts)
  }

  public search = (opts) => this.find(opts)

  public createTables = async ():Promise<void> => {
    for (const name of this._getTablesNames()) {
      await this.hooks.fire('createTable', name)
      await this.tablesByName[name].create()
    }
  }

  public destroyTables = async ():Promise<void> => {
    for (const name of this._getTablesNames()) {
      await this.hooks.fire('destroyTable', name)
      await this.tablesByName[name].destroy()
    }
  }

  public hook = (method, handler) => this.hooks.hook(method, handler)

  // public hasTableForModel = (model:any|string) => {
  //   const id = typeof model === 'string' ? model : model.id
  //   return !!this.tables[id]
  // }

  private _getTablesNames = ():string[] => {
    return this.tableTableNames.concat(Object.keys(this.exclusive))
  }
}

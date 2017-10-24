import { EventEmitter } from 'events'
import validateResource = require('@tradle/validate-resource')
import { TYPE } from '@tradle/constants'
import {
  getValues,
  minBy,
  sha256,
  getTableName,
  validateTableName,
  getFilterType,
  lazyDefine,
  levenshteinDistance,
} from './utils'

import Table from './table'
import { DynogelIndex, ITableOpts, Models, TableChooser, FindOpts } from './types'
import { NotFound } from './errors'
const { isInstantiable } = validateResource.utils

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
  public models: any
  public objects: any
  // table bucket name => bucket
  public tablesByName:{ [key:string]: Table }
  // tables by type (model.id)
  public tables:{ [key:string]: Table }
  public exclusive: { [key:string]: Table }
  private tableOpts: ITableOpts
  private tableTableNames: string[]
  private _choose:TableChooser
  constructor ({
    tableOpts,
    tableNames,
    chooseTable=defaultTableChooser
  }: {
    tableNames: string[]
    tableOpts: ITableOpts
    chooseTable?: TableChooser
  }) {
    super()

    tableNames.forEach(validateTableName)

    const { models, objects } = tableOpts
    this.tableTableNames = tableNames
    this.objects = objects
    this.tableOpts = { ...tableOpts }
    this.exclusive = {}
    this.setModels(models)
    this._choose = chooseTable
  }

  public setExclusive = ({ name, model, opts, table }: {
    model: any,
    name?: string,
    opts?: ITableOpts,
    table?: Table
  }):void => {
    if (!table) {
      if (!name) name = getTableName({ model })

      table = new Table(name, {
        ...this.tableOpts,
        exclusive: true,
        model
      })
    }

    this.tablesByName[model.id] = table
    this.tables[model.id] = table
    this.exclusive[model.id] = table
  }

  public choose = (type:string):Table => {
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

  public put = async (item):Promise<void> => {
    await this.tables[item[TYPE]].put(item)
  }

  public get = async (keys:any):Promise<any> => {
    return await this.tables[keys[TYPE]].get(keys)
  }

  public latest = async (keys:any):Promise<any> => {
    return await this.tables[keys[TYPE]].latest(keys)
  }

  public del = async (keys:any):Promise<void> => {
    await this.tables[keys[TYPE]].del(keys)
  }

  public batchPut = async (resources:any[]):Promise<void> => {
    const byTable = new Map<Table, any[]>()
    for (const resource of resources) {
      const type = resource[TYPE]
      const table = this.tables[type]
      const soFar = byTable.get(table) || []
      soFar.push(resource)
      byTable.set(table, soFar)
    }

    const entries = Array.from(byTable.entries())
    await Promise.all(entries.map(([table, resources]) => {
      return table.batchPut(resources)
    }))
  }

  public find = async (opts:FindOpts) => {
    const type = getFilterType(opts)
    return this.tables[type].find(opts)
  }

  public findOne = async (opts) => {
    opts = { ...opts, limit: 1 }
    const { items=[] } = await this.find(opts)
    if (!items.length) {
      throw new NotFound(`query: ${JSON.stringify(opts)}`)
    }

    return items[0]
  }

  public search = async (...args) => this.find(...args)

  public createTables = async (opts):Promise<void> => {
    for (const name of this._getTablesNames()) {
      await this.tablesByName[name].create()
    }
  }

  public destroyTables = async (opts):Promise<void> => {
    for (const name of this._getTablesNames()) {
      await this.tablesByName[name].destroy()
    }
  }

  public addModels = (models:Models):void => {
    if (Object.keys(models).length) {
      this.setModels({ ...this.models, ...models })
    }
  }

  public setModels = (models:Models):void => {
    this.models = models
    this.tableOpts.models = models
    this.tables = {}
    this.tablesByName = {}
    lazyDefine(
      this.tablesByName,
      this.tableTableNames,
      tableName => new Table(tableName, this.tableOpts)
    )

    lazyDefine(
      this.tables,
      Object.keys(models),
      type => this.choose(type)
    )

    for (let id in this.exclusive) {
      let table = this.exclusive[id]
      this.tables[table.model.id] = table
      this.tablesByName[table.name] = table
    }

    this.emit('update:models', { models })
  }

  private _getTablesNames = ():string[] => {
    return this.tableTableNames.concat(Object.keys(this.exclusive))
  }
}

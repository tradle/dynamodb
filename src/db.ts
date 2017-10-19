import validateResource = require('@tradle/validate-resource')
import { TYPE } from '@tradle/constants'
import {
  getValues,
  minBy,
  sha256,
  getTableName,
  validateTableName,
  getFilterType,
  lazyDefine
} from './utils'
import Bucket from './bucket'
import { IBucketOpts, Models } from './types'
import { NotFound } from './errors'
const { isInstantiable } = validateResource.utils

export default class DB {
  public models: any
  public objects: any
  // bucket name => bucket
  public tablesByName:{ [key:string]: Bucket }
  // tables by type (model.id)
  public tables:{ [key:string]: Bucket }
  public exclusive: { [key:string]: Bucket }
  private tableOpts: IBucketOpts
  private tableBucketNames: string[]
  private tableNameHashes: string[]
  constructor ({ tableOpts, tableNames }: {
    tableNames: string[]
    tableOpts: IBucketOpts
  }) {
    tableNames.forEach(validateTableName)

    const { models, objects } = tableOpts
    this.tableBucketNames = tableNames
    this.tableNameHashes = tableNames.map(sha256)
    this.models = models
    this.objects = objects
    this.tableOpts = { ...tableOpts }
    this.exclusive = {}
    this.setModels(models)
  }

  // public getTableForType = (type:string):Bucket => {
  //   return this.exclusive[type] || this.tables[type]
  // }

  // public getTableForModel = (model):Bucket => {
  //   return this.getTableForType(model.id)
  // }

  public setExclusive = ({ name, model, opts, table }: {
    model: any,
    name?: string,
    opts?: IBucketOpts,
    table?: Bucket
  }):void => {
    if (!table) {
      if (!name) name = getTableName({ model })

      table = new Bucket(name, {
        ...this.tableOpts,
        exclusive: true,
        model
      })
    }

    this.tablesByName[model.id] = table
    this.tables[model.id] = table
    this.exclusive[model.id] = table
  }

  public choose = (type:string):Bucket => {
    const hash = sha256(type)
    const tableName = minBy(this.tableBucketNames, (name, i) => {
      return Bucket.distanceRaw(hash, this.tableNameHashes[i])
    })

    // save alias
    const table = this.tables[type] = this.tablesByName[tableName]
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
    const byTable = new Map<Bucket, any[]>()
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

  public find = async (opts) => {
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
    this.setModels({ ...this.models, ...models })
  }

  public setModels = (models:Models):void => {
    this.models = models
    this.tableOpts.models = models
    this.tables = {}
    this.tablesByName = {}
    lazyDefine(
      this.tablesByName,
      this.tableBucketNames,
      tableName => new Bucket(tableName, this.tableOpts)
    )

    lazyDefine(
      this.tables,
      Object.keys(models),
      type => this.choose(type)
    )

    for (let id in this.exclusive) {
      let { name } = this.exclusive[id]
      this.tables[name] = table
      this.tablesByName[name] = table
    }
  }

  private _getTablesNames = ():string[] => {
    return this.tableBucketNames.concat(Object.keys(this.exclusive))
  }
}

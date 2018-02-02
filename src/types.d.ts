
import AWS = require('aws-sdk')
import { Table } from './table'
import { ModelStore } from './model-store'

type IndexType = 'global'|'local'

export type DynogelIndex = {
  hashKey: string
  rangeKey?: string
  name: string
  type: IndexType
  projection: AWS.DynamoDB.Types.Projection
}

export type Model = {
  id: string
  properties: any
  primaryKeys?: KeyProps
}

export type Models = {
  [key:string]: Model
}

export interface Objects {
  get: (key:string) => Promise<any>
  // allow additional properties
  [key: string]: any
}

export type ReadOptions = {
  consistentRead?: boolean
}

export interface IDBOpts {
  tableNames: string[]
  modelStore: ModelStore
  defineTable: (name:string) => Table
  chooseTable?: TableChooser
}

export interface ITableOpts {
  models: Models
  objects?: Objects
  docClient: AWS.DynamoDB.DocumentClient
  tableDefinition: DynogelTableDefinition
  requireSigned?: boolean
  validate?: boolean
  exclusive?: boolean
  model?: Model
  hashKey?: string
  rangeKey?: string
  forbidScan?: boolean
  readOnly?: boolean
  defaultReadOptions?: ReadOptions
  maxItemSize?: number
}

export type KeyProps = {
  hashKey: string
  rangeKey?: string
}

export type BackoffOptions = {
  backoff: (attempts:number) => number
  maxTries: number
}

export type TableChooserInput = {
  tables:Table[]
  type:string
}

export type TableChooser = (TableChooserInput) => Table

export type Pojo = {
  [key: string]: any
}

export type EQ = {
  _t: string
  [key: string]: any
}

export type Filter = {
  EQ: Pojo
  NEQ?: Pojo
  NULL?: Pojo
  IN?: Pojo
  NOT_IN?: Pojo
  BETWEEN?: Pojo
  STARTS_WITH?: Pojo
  CONTAINS?: Pojo
  NOT_CONTAINS?: Pojo
  LT?: Pojo
  LTE?: Pojo
  GT?: Pojo
  GTE?: Pojo
}

export type OrderBy = {
  property: string
  desc?: boolean
}

export type FindOpts = {
  table?: Table
  filter?: Filter
  orderBy?: OrderBy
  select?: string[]
  checkpoint?: any
  limit?: number
}

export type DynogelTableDefinition = {
  tableName: string,
  hashKey: string
  rangeKey?: string
  schema: any
  indexes?: DynogelIndex[]
  timestamps?: boolean
  createdAt?: string|boolean
  updatedAt?: string|boolean
  validation?: any
}

// export type Cache = {
//   get: (...any) => any
//   set: (key:string, value:any) => void
// }

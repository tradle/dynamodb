
import AWS = require('aws-sdk')
import {
  PathElement,
} from '@aws/dynamodb-expressions'

import { Table } from './table'
import { ModelStore } from './model-store'
import { Search } from './search'

export { Table, ModelStore, Search }

type IndexType = 'global'|'local'

// export type PropertyDeriver = (item: any) => string | number

export type ReadWriteType = 'read' | 'write'

export type PropsDeriverInput = {
  table: Table
  item: any
  isRead: boolean
  noConstants?: boolean
}

export type PropsDeriver = (opts: PropsDeriverInput) => any

export type DerivedPropsParserInput = {
  table: Table
  model: Model
  resource: any
}

export type DerivedPropsParser = (opts: DerivedPropsParserInput) => any

export type ResolveOrderByInput = {
  table: Table
  type: string
  hashKey: string
  property: string
  item?: any
}

export type ResolvedOrderBy = {
  property: string
  vars: string[]
  full: boolean
  prefix: string
  renderablePrefixVars: string[]
  // firstUnrenderableVar: string
  canOrderBy: string[]
}

export type ResolveOrderBy = (opts: ResolveOrderByInput) => ResolvedOrderBy

// export interface IKeysDeriver {
//   [hashKey]: PropertyDeriver
//   rangeKey: PropertyDeriver
// }

export type IDynamoDBKey = {
  hashKey: string
  rangeKey?: string
}

export interface IDynogelIndex extends IDynamoDBKey {
  name: string
  type: IndexType
  projection: AWS.DynamoDB.Types.Projection
}

export type Model = {
  id: string
  title: string
  properties: any
  abstract?: boolean
  interfaces?: string[]
  isInterface?: boolean
  subClassOf?: string
  required?: string[]
  viewCols?: string[]
  editCols?: string[]
  hidden?: string[]
  primaryKeys?: string|KeyProps|IndexedProperty
  indexes?: any[]
  [attr:string]: any
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
  logger?: ILogger
}

export interface ITableDefinition extends IDynogelTableDefinition {
  defaultReadOptions?: ReadOptions
  primaryKeys?: KeyProps
}

type TableAndModel = {
  table: Table
  model: Model
}

export type GetIndexesForModel = (opts: TableAndModel) => IndexedProperty[]
export type GetPrimaryKeysForModel = (opts: TableAndModel) => IndexedProperty

type _AllowScan = (op:Search) => boolean
export type AllowScan = boolean | _AllowScan
export type ShouldMinify = (item:any) => boolean

export interface ITableOpts {
  models: Models
  modelsStored?: Models
  objects?: Objects
  docClient: AWS.DynamoDB.DocumentClient
  tableDefinition: AWS.DynamoDB.CreateTableInput|ITableDefinition
  requireSigned?: boolean
  validate?: boolean
  exclusive?: boolean
  model?: Model
  hashKey?: string
  rangeKey?: string
  allowScan?: AllowScan
  readOnly?: boolean
  defaultReadOptions?: ReadOptions
  maxItemSize?: number
  deriveProps?: PropsDeriver
  derivedProps?: string[]
  parseDerivedProps?: DerivedPropsParser
  resolveOrderBy?: ResolveOrderBy
  getIndexesForModel?: GetIndexesForModel
  getPrimaryKeysForModel?: GetPrimaryKeysForModel
  shouldMinify?: ShouldMinify
  logger?: ILogger
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
  SUBCLASS_OF?: Pojo
}

export type FilterResultsInput = {
  models: Models
  model?: Model
  filter?: Filter
  results: any[]
}

export type MatchesFilterInput = {
  models: Models
  model?: Model
  filter?: Filter
  object: any
}

export type IsEqualInput = {
  models: Models
  property?: any
  condition: any
  value: any
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
  batchLimit?: number
  allowScan?: AllowScan
  keepDerivedProps?: boolean
}

export interface IDynogelTableDefinition {
  tableName: string,
  hashKey: string
  rangeKey?: string
  schema: any
  indexes?: IDynogelIndex[]
  timestamps?: boolean
  createdAt?: string|boolean
  updatedAt?: string|boolean
  validation?: any
  deriveProps?: PropsDeriver
}

export type KeyTemplate = {
  template: string
}

export type IndexedProperty = {
  hashKey: KeyTemplate
  rangeKey?: KeyTemplate
}

// export type Cache = {
//   get: (...any) => any
//   set: (key:string, value:any) => void
// }

// export interface IItemOpts {
//   item: any
//   opts?: any
// }

// export interface IBatchPutOpts {
//   items: any[]
//   backoffOpts
// }

// export interface IKeysOpts {
//   keys: any
//   opts?: any
// }

export type PropPath = string|string[]
export type PathAndValuePair = [PropPath, any]
export type DiffType = 'add'|'remove'|'replace'
export type DiffPart = {
  op: DiffType
  path: string[]
  value: any
}

export type Diff = DiffPart[]

export interface ILogger {
  log: Function
  info: Function
  warn: Function
  error: Function
  debug: Function
  silly: Function
}

interface IItemPosition {
  [key: string]: any
}

export type ItemToPosition = (item: any) => IItemPosition

export type SearchResult = {
  items: any[]
  itemToPosition: ItemToPosition
  startPosition: IItemPosition
  endPosition: IItemPosition
  index: IDynogelIndex
}

export type ReindexOpts = {
  model: Model
  batchSize?: number
  findOpts?: any
}

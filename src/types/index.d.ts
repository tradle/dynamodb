
import AWS = require('aws-sdk')
// import Bucket from '../bucket'

type IndexType = 'global'|'local'

export type DynogelIndex = {
  hashKey: string
  rangeKey?: string
  name: string
  type: IndexType
  projection: {
    ProjectionType: AWS.DynamoDB.Types.ProjectionType
  }
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

export interface IBucketOpts {
  models: Models
  objects: Objects
  docClient: AWS.DynamoDB.DocumentClient
  tableDefinition?: DynogelTableDefinition
  requireSigned?: boolean
  validate?: boolean
  exclusive?: boolean
  model?: Model
  hashKey?: string
  rangeKey?: string
  forbidScan?: boolean
  bodyInObjects?: boolean
  defaultReadOptions?: ReadOptions
  maxItemSize?: number
  indexes?: DynogelIndex[]
}

export type KeyProps = {
  hashKey: string
  rangeKey?: string
}

export type BackoffOptions = {
  backoff: (attempts:number) => number
  maxTries: number
}

// export type BucketChooser = ({
//   buckets:Bucket[],
//   type:string
// }) => Bucket


export type BucketChooserInput = {
  tables:Bucket[]
  type:string
}

export type BucketChooser = (BucketChooserInput) => Bucket

export type Pojo = {
  [key: string]: any
}

export type EQ = {
  _t: string
  [key: string]: any
}

export type Filter = {
  EQ
  NEQ?: Pojo
  NULL?: Pojo
  IN?: any[]
  BETWEEN?: any[]
  STARTS_WITH?: Pojo
  CONTAINS?: Pojo
  NOT_CONTAINS?: Pojo
  LT?: string|number
  LTE?: string|number
  GT?: string|number
  GTE?: string|number
}

export type OrderBy = {
  property: string
  desc?: boolean
}

export type FindOpts = {
  filter?: Filter
  orderBy?: OrderBy
  select?: string[]
  after?: any
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

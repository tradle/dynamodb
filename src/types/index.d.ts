
import AWS = require('aws-sdk')

type IndexType = 'global'|'local'

export interface IIndex {
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
}

export type Models = {
  [key:string]: Model
}

export interface Objects {
  get: (key:string) => Promise<any>
  // allow additional properties
  [key: string]: any
}

export interface IBucketOpts {
  models: Models
  objects: Objects
  docClient: AWS.DynamoDB.DocumentClient
  requireSigned?: boolean
  validate?: boolean
  exclusive?: boolean
  model?: Model
  hashKey?: string
  rangeKey?: string
  forbidScan?: boolean
  bodyInObjects?: boolean
  defaultReadOptions?: any
  maxItemSize?: number
  indexes?: IIndex[]
}

export type KeyProps = {
  hashKey: string
  rangeKey?: string
}

export type BackoffOptions = {
  backoff: (attempts:number) => number
  maxTries: number
}

export type OrderBy = {
  property: string
  desc?: boolean
}

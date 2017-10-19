import Bucket from './bucket'
import { Model, Models } from './types'

export default class Table {
  public models:Models
  public model:Model
  public bucket:Bucket
  public type:string
  constructor({
    bucket,
    models,
    model
  }: {
    bucket: Bucket
    models: Models
    model: Model
  }) {
    this.models = models
    this.model = model
    this.type = model.id
    this.bucket = bucket
  }

  public put = async (opts) => {
    if (!opts.filter) {
      opts.filter = {}
    }

    if (!opts.filter.EQ) {
      opts.filter.EQ = {}
    }

    opts.filter.EQ = this.model.id
    return this.bucket.put(opts)
  }

  // public get = async (opts) => {
  //   return this.bucket.get({ ...opts, [TYPE]: this.type })
  // }
}

import _ = require('lodash')
import { EventEmitter } from 'events'
import mergeModels = require('@tradle/merge-models')
import {
  Model,
  Models
} from './types'

const promiseNoop = async () => {}

export type OnMissingModelPromiser = (id:string) => Promise<void>

export class ModelStore extends EventEmitter {
  public models: Models
  private onMissingModel: OnMissingModelPromiser
  constructor({ models={}, onMissingModel=promiseNoop }: {
    models?: Models,
    onMissingModel?: OnMissingModelPromiser
  }) {
    super()
    this.models = models || {}
    this.onMissingModel = onMissingModel
  }

  public get = async (id:string):Promise<Model> => {
    let model = this.models[id]
    if (!model) {
      await this.onMissingModel(id)
      model = this.models[id]
    }

    if (!model) throw new Error(`model not found: ${id}`)

    return model
  }

  public addModel = (model:Model) => {
    this.addModels({ [model.id]: model })
  }

  public addModels = (models:Models) => {
    this.models = mergeModels()
      .add(this.models, { validate: false })
      .add(models)
      .get()

    this.emit('update')
  }

  public removeModels = (models:Models) => {
    this.models = _.omit(this.models, Object.keys(models))
  }
}

export const createModelStore = (opts):ModelStore => new ModelStore(opts)

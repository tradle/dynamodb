import { TYPE } from '@tradle/constants'
import {
  sortResults,
  debug,
  getIndexes,
  extend,
  resultsToJson
} from './utils'

import filterDynamodb from './filter-dynamodb'
import {
  Model,
  Models,
  Objects,
  Filter,
  OrderBy
} from './types'
import DB from './db'

export = function createResolvers ({ db, objects, models, postProcess }: {
  db: DB
  models: Models
  objects: Objects
  postProcess?: Function
}) {

  const update = async ({ model, props }: { model: Model, props }) => {
    const result = await db.update(props)
    return resultsToJson(result)
  }

  const put = async ({ model, props }: { model: Model, props }) => {
    const result = await db.put(props)
    return resultsToJson(result)
  }

  const getByLink = objects && objects.get
  const get = async ({ model, key }: { model: Model, key: any }) => {
    let result
    try {
      result = await db.get(model.id, key)
    } catch (err) {
      if (err.name && err.name.toLowerCase() === 'notfound') {
        return null
      }

      throw err
    }

    return result ? resultsToJson(result) : null
  }

  const list = async ({ model, select, filter, orderBy, limit, after }: {
    model: Model
    select?: string[]
    filter?: Filter,
    orderBy?: OrderBy,
    limit?: number
    after?: any
  }) => {
    if (!filter) filter = { EQ: {} }
    if (!filter.EQ) filter.EQ = {}
    filter.EQ[TYPE] = model.id

    return db.find({
      select,
      filter,
      orderBy,
      limit,
      after
    })
  }

  const raw = {
    list,
    get,
    getByLink,
    update
  }

  if (!postProcess) return raw

  const wrapped = {}
  for (let op in raw) {
    wrapped[op] = withPostProcess(raw[op], op)
  }

  return wrapped

  function withPostProcess (fn, op) {
    return async (...args) => {
      const result = await fn(...args)
      return postProcess(result, op)
    }
  }
}

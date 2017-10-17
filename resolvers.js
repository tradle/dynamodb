const co = require('co').wrap
const { TYPE } = require('@tradle/constants')
const {
  sortResults,
  debug,
  getIndexes,
  extend,
  resultsToJson
} = require('./utils')

const filterDynamodb = require('./filter-dynamodb')

module.exports = function createResolvers ({ db, objects, models, postProcess }) {

  const update = co(function* ({ model, props }) {
    const result = yield db.update(props)
    return resultsToJson(result)
  })

  const getByLink = objects && objects.get
  const get = co(function* ({ model, key }) {
    let result
    try {
      result = yield db.tables[model.id].get(key)
    } catch (err) {
      if (err.name && err.name.toLowerCase() === 'notfound') {
        return null
      }

      throw err
    }

    return result ? resultsToJson(result) : null
  })

  const list = function list ({ model, select, filter={}, orderBy, limit, after }) {
    if (!filter.EQ) {
      filter.EQ = {}
    }

    filter.EQ[TYPE] = model.id
    return db.search({
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
    return co(function* (...args) {
      const result = yield fn(...args)
      return postProcess(result, op)
    })
  }
}

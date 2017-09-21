const co = require('co').wrap
const {
  sortResults,
  debug,
  getIndexes,
  extend,
  resultsToJson
} = require('./utils')

// const { filterResults } = require('./filter-memory')
const filterDynamodb = require('./filter-dynamodb')

module.exports = function createResolvers ({ tables, objects, models, postProcess }) {

  const update = co(function* ({ model, props }) {
    const result = yield tables[model.id].update(props)
    return resultsToJson(result)
  })

  const get = co(function* ({ model, key }) {
    const result = yield tables[model.id].get(key)
    return result ? resultsToJson(result) : null
  })

  const list = function list ({ model, select, filter, orderBy, limit, after }) {
    const table = tables[model.id]
    return table.search({
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

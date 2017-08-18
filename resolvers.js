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
const primaryKey = require('./constants').hashKey

module.exports = function createResolvers ({ tables, objects, models }) {

  const update = co(function* ({ model, props }) {
    const result = yield tables[model.id].update(props)
    return resultsToJson(result)
  })

  const get = co(function* ({ model, key }) {
    const result = yield tables[model.id].get(key)
    return result ? resultsToJson(result) : null
  })

  const list = function list ({ model, filter, orderBy, limit, after }) {
    const table = tables[model.id]
    return table.search({
      filter,
      orderBy,
      limit,
      after
    })
  }

  function getQueryBy ({ model, props }) {
    if (primaryKey in props) {
      return {
        value: props[primaryKey],
        // rangeKey: props[rangeKey]
      }
    }

    // TODO: lazify, cachify
    const index = getIndexes({ model, models })
      .find(indexDef => indexDef.hashKey in props)

    if (index) {
      return {
        index: index.name,
        value: props[index.hashKey],
        // rangeKey: props[index.rangeKey]
      }
    }
  }

  return {
    list,
    get,
    update
  }
}

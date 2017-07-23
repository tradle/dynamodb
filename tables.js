const toJoi = require('@tradle/schema-joi')
const Table = require('./table')

module.exports = function createTables ({ objects, models, prefix, maxItemSize }) {
  const tables = {}
  Object.keys(models).forEach(id => {
    const model = models[id]
    let table
    Object.defineProperty(tables, model.id, {
      enumerable: true,
      get: function () {
        if (!table) {
          const joi = toJoi({ models, model })
          table = new Table({ objects, model, joi, prefix, maxItemSize })
        }

        return table
      }
    })
  })

  return tables
}

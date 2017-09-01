const toJoi = require('@tradle/schema-joi')
const { TYPE } = require('@tradle/constants')
const Table = require('./table')

module.exports = function createTables (opts) {
  const tables = {}
  const { models } = opts
  Object.keys(models).forEach(id => {
    const model = models[id]
    let table
    Object.defineProperty(tables, model.id, {
      enumerable: true,
      get: function () {
        if (!table) {
          const joi = toJoi({ models, model })
          const tableOpts = Object.assign({ joi, model }, opts)
          table = new Table(tableOpts)
        }

        return table
      },
      set: function (value) {
        table = value
      }
    })
  })

  return tables
}

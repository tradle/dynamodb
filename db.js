const toJoi = require('@tradle/schema-joi')
const { TYPE } = require('@tradle/constants')
const mergeModels = require('@tradle/merge-models')
const Table = require('./table')
const { omit, shallowClone } = require('./utils')

module.exports = function createTables (opts) {
  opts = shallowClone(opts)

  let models = {}
  const tables = {}
  const proxy = {
    tables,
    addModels,
    get models() {
      return models
    }
  }

  function addModels (additionalModels) {
    if (!Object.keys(additionalModels).length) {
      return proxy
    }

    const merge = mergeModels()
      .add(models)
      .add(additionalModels)

    additionalModels = merge.rest()
    models = merge.get()
    opts.models = models
    Object.keys(additionalModels).forEach(id => {
      const model = models[id]
      let table
      Object.defineProperty(tables, id, {
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
  }

  ;['put', 'merge'].forEach(method => {
    proxy[method] = (...args) => {
      const item = args[0]
      return tables[item[TYPE]][method](...args)
    }
  })

  ;['get', 'del'].forEach(method => {
    proxy[method] = ({ type, link }) => {
      return tables[type][method](link)
    }
  })

  ;['latest'].forEach(method => {
    proxy[method] = ({ type, permalink }) => {
      return tables[type][method](permalink)
    }
  })

  ;['search', 'find', 'findOne'].forEach(method => {
    proxy[method] = opts => {
      const { type } = opts
      const rest = omit(opts, ['type'])
      return tables[type][method](rest)
    }
  })

  ;['batchPut'].forEach(method => {
    proxy[method] = (items, ...rest) => {
      const type = items[0][TYPE]
      const same = items.every((item, i) => {
        return i === 0 || item[TYPE] === type
      })

      if (!same) {
        throw new Error('all items must be of the same type')
      }

      return tables[type].batchPut(items, ...rest)
    }
  })

  if (opts.models) {
    addModels(opts.models)
  }

  return proxy
}

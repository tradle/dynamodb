const { TYPE } = require('@tradle/constants')
const createTables = require('./tables')
const { omit } = require('./utils')

module.exports = function proxy (opts) {
  const {
    tables=createTables(opts)
  } = opts

  const proxy = {
    tables
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

  ;['search'].forEach(method => {
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

  return proxy
}

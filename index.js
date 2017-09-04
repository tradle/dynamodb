const Table = require('./table')
const createTables = require('./tables')
const createProxy = require('./proxy')
const utils = require('./utils')
const constants = require('./constants')
const errors = require('./errors')
const createResolvers = require('./resolvers')

module.exports = {
  Table,
  createTables,
  createTable: opts => new Table(opts),
  db: createProxy,
  proxy: createProxy,
  utils,
  constants,
  errors,
  createResolvers
}

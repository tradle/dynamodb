const Table = require('./table')
const createTables = require('./tables')
const utils = require('./utils')
const constants = require('./constants')
const createResolvers = require('./resolvers')

module.exports = {
  Table,
  createTables,
  createTable: opts => new Table(opts),
  utils,
  constants,
  createResolvers
}

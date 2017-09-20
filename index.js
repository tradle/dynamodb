const Table = require('./table')
const createDB = require('./db')
const utils = require('./utils')
const constants = require('./constants')
const errors = require('./errors')
const createResolvers = require('./resolvers')

module.exports = {
  Table,
  createTable: opts => new Table(opts),
  db: createDB,
  utils,
  constants,
  errors,
  createResolvers
}

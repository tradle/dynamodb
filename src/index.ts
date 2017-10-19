import Table from './bucket'
import DB from './db'
import utils = require('./utils')
import constants = require('./constants')
import errors = require('./errors')
import createResolvers = require('./resolvers')

const createTable = opts => new Table(opts)

export {
  Table,
  createTable,
  DB,
  utils,
  constants,
  errors,
  createResolvers
}

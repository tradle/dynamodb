import Table from './table'
import DB from './db'
import utils = require('./utils')
import constants = require('./constants')
import errors = require('./errors')
import createResolvers = require('./resolvers')

const createTable = (name, opts) => new Table(name, opts)

export {
  Table,
  createTable,
  DB,
  utils,
  constants,
  errors,
  createResolvers
}

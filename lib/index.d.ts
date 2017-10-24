import Table from './table';
import DB from './db';
import utils = require('./utils');
import constants = require('./constants');
import errors = require('./errors');
import createResolvers = require('./resolvers');
declare const createTable: (name: any, opts: any) => Table;
export { Table, createTable, DB, utils, constants, errors, createResolvers };

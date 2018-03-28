import { flatten, identity } from 'lodash'
import { TYPE } from '@tradle/constants'
import { separator } from '../constants'
import {
  IDynogelTableDefinition,
  IDynogelIndex,
  ITableOpts,
  PropsDeriver,
  ITableDefinition,
  ResolveOrderBy
} from '../types'

import { prefixString, prefixKeys, prefixValues } from '../prefix'
import { createControlLatestHook } from '../hooks'

import {
  DB,
  Table,
  createModelStore,
  utils
} from '../'

const cloudformation = require('./fixtures/table-schema.json')
const tableDefinition = utils.toDynogelTableDefinition(cloudformation)

export const defaultTableDefinition = tableDefinition
export const defaultIndexes = tableDefinition.indexes

const getDefaultDeriveProperties = (def:ITableDefinition):PropsDeriver => (resource, forRead) => {
  const derived = {}
  if (resource[TYPE] && resource._permalink) {
    derived[def.hashKey] = [resource._permalink, resource[TYPE]].join(separator)
    derived[def.rangeKey] = '__placeholder__'
  }

  if (resource._author) {
    derived[def.indexes[0].hashKey] = ['_author', resource._author].join(separator)
  }

  if (resource[TYPE]) {
    derived[def.indexes[1].hashKey] = [TYPE, resource[TYPE]].join(separator)
  }

  if (resource._time) {
    derived[def.indexes[0].rangeKey] =
    derived[def.indexes[1].rangeKey] = String(resource._time)
  }

  const rangeKeys = def.indexes.map(def => def.rangeKey)
    .concat(def.rangeKey)
    .filter(identity)

  return prefixValues(derived, 'tradle.Object', rangeKeys)
}

type CommonTableOpts = {
  maxItemSize: number
  validate: boolean
  tableDefinition: IDynogelTableDefinition
  derivedProperties: string[]
  deriveProperties: PropsDeriver
  resolveOrderBy?: ResolveOrderBy
}

export const getCommonTableOpts = (tableName, indexes?): CommonTableOpts => {
  const def = {
    ...tableDefinition,
    tableName,
    indexes: indexes || tableDefinition.indexes
  }

  const derivedProperties:string[] = flatten([
    def.hashKey,
    def.rangeKey,
  ].concat(def.indexes.map(i => [i.hashKey, i.rangeKey])))
  .filter(i => i)

  return {
    maxItemSize: 4000,
    validate: false,
    tableDefinition: def,
    derivedProperties,
    deriveProperties: getDefaultDeriveProperties(def),
    resolveOrderBy: ({ type, hashKey, property }) => {
      if (hashKey !== def.hashKey && property === '_time') {
        return def.indexes
          .find(index => index.hashKey === hashKey)
          .rangeKey
      }

      return property
    }
  }
}

export const createDB = ({
  models,
  objects,
  docClient,
  indexes,
  tableNames
}):DB => {
  const db = new DB({
    modelStore: createModelStore({ models }),
    tableNames,
    // tableNames: lastCreated,
    defineTable: name => {
      const opts = getCommonTableOpts(DB.getSafeTableName(name), indexes)
      const table = new Table({
        ...opts,
        models,
        objects,
        docClient
      })

      table.hook('put:pre', createControlLatestHook(table, 'put'))
      table.hook('update:pre', createControlLatestHook(table, 'update'))
      return table
    }
  })

  return db
}

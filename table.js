const debug = require('debug')(require('./package.json').name)
const co = require('co').wrap
const bindAll = require('bindall')
const typeforce = require('typeforce')
const dynogels = require('dynogels')
const extend = require('xtend/mutable')
const shallowClone = require('xtend')
const promisify = require('pify')
const omit = require('object.omit')
const toJoi = require('@tradle/schema-joi')
const BaseObjectModel = require('@tradle/models')['tradle.Object']
const minify = require('./minify')
const metadataTypes = toJoi({
  model: BaseObjectModel
})

const RESOLVED = Promise.resolve()
const { hashKey, minifiedFlag, defaultIndexes } = require('./constants')
const { getTableName, getIndexes } = require('./utils')

module.exports = DynamoTable

function DynamoTable ({
  joi,
  model,
  objects,
  prefix,
  suffix,
  tableName,
  createIfNotExists=true
}) {
  bindAll(this)

  if (!(joi && model)) {
    throw new Error('joi and model are required')
  }

  this.joi = joi
  this.model = model
  this.objects = objects
  if (createIfNotExists === false) {
    this._tableExistsPromise = RESOLVED
  } else {
    let promise
    Object.defineProperty(this, '_tableExistsPromise', {
      get: () => {
        if (!promise) {
          promise = this._maybeCreate()
        }

        return promise
      }
    })
  }

  const tableDef = {
    hashKey,
    tableName: tableName || getTableName({ model, prefix, suffix }),
    timestamps: true,
    createdAt: false,
    updatedAt: '_dateUpdated',
    schema: extend({}, joi, metadataTypes),
    indexes: getIndexes(model)
  }

  const table = dynogels.define(model.id, tableDef)
  this.table = promisify(table, {
    include: ['createTable', 'create', 'get', 'update', 'destroy']
  })

  ;['scan', 'query'].forEach(op => {
    this[op] = (...args) => {
      const builder = table[op](...args)
      const exec = promisify(builder.exec.bind(builder))
      builder.exec = wrapDBOperation(this, exec)
      return builder
    }
  })
}

DynamoTable.prototype._maybeCreate = co(function* () {
  try {
    yield this.createTable()
  } catch (err) {
    if (err.code !== 'ResourceInUseException') {
      this._tableExistsPromise = null
      debug('failed to create table', err)
      throw err
    }
  }
})

DynamoTable.prototype.createTable = function () {
  return this.table.createTable()
}

DynamoTable.prototype._getMin = function (key) {
  return this.table.get(key[hashKey])
}

DynamoTable.prototype.get = co(function* (key) {
  yield this._tableExistsPromise
  const instance = yield this._getMin(key)
  if (!instance) return null

  yield maybeInflate(this, instance)
  return instance.toJSON()
})

DynamoTable.prototype.create = function (item, options) {
  typeforce({
    _author: 'String',
    _link: 'String',
    _time: typeforce.oneOf('String', 'Number')
  }, item)

  return this._write('create', item, options)
}

DynamoTable.prototype.update = function (item, options) {
  return this._write('update', item, options)
}

DynamoTable.prototype._write = co(function* (method, item, options) {
  yield this._tableExistsPromise
  const { model } = this
  const { min, diff, isMinified } = minify({ model, item })
  const result = yield this.table[method](min, options)
  return extend(result.toJSON(), diff)
})

DynamoTable.prototype.destroy = co(function* (key, options) {
  key = this.deflate(key)
  yield this._tableExistsPromise
  const result = yield this.table.destroy(key, options)
  return result.toJSON()
})

function wrapDBOperation (dynamoTable, fn) {
  const { model, objects } = dynamoTable
  return co(function* (...args) {
    yield dynamoTable._tableExistsPromise

    const result = yield fn.apply(dynamoTable, args)
    if (!result) return result

    const { Item, Items } = result
    if (Item) {
      yield maybeInflate(dynamoTable, Item)
      result.Item = Item.toJSON()
    } else if (Items) {
      yield Promise.all(Items.map(Item => {
        return maybeInflate(dynamoTable, Item)
      }))

      result.Items = Items.map(Item => Item.toJSON())
    }

    return result
  })
}

const maybeInflate = co(function* (dynamoTable, instance) {
  if (instance.get(minifiedFlag)) {
    const link = instance.get(hashKey)
    const full = yield dynamoTable.objects.get(link)
    instance.set(full)
  }

  return instance
})

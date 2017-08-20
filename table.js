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
const filterDynamoDB = require('./filter-dynamodb')
const metadataTypes = toJoi({
  model: BaseObjectModel
})

const RESOLVED = Promise.resolve()
const { hashKey, minifiedFlag, defaultIndexes } = require('./constants')
const { getTableName, getIndexes } = require('./utils')
const types = {
  item: typeforce.compile({
    _author: 'String',
    _link: 'String',
    _time: typeforce.oneOf('String', 'Number')
  })
}

module.exports = DynamoTable

function DynamoTable ({
  joi,
  model,
  objects,
  prefix,
  suffix,
  tableName,
  createIfNotExists=true,
  maxItemSize,
  docClient
}) {
  bindAll(this)

  if (!(joi && model)) {
    throw new Error('joi and model are required')
  }

  this.joi = joi
  this.model = model
  this.objects = objects
  this.maxItemSize = maxItemSize
  this.docClient = docClient
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

  if (!tableName) {
    tableName = getTableName({ model, prefix, suffix })
  }

  this.name = tableName

  const tableDef = {
    hashKey,
    tableName,
    timestamps: true,
    createdAt: false,
    updatedAt: '_dateUpdated',
    schema: extend({}, joi, metadataTypes),
    indexes: getIndexes(model),
    validation: {
      allowUnknown: true
    }
  }

  const table = dynogels.define(model.id, tableDef)
  this.table = promisify(table, {
    include: ['createTable', 'create', 'get', 'update', 'destroy']
  })

  ;['scan', 'query'].forEach(op => {
    this[op] = (...args) => {
      const builder = table[op](...args)
      // const exec = promisify(builder.exec.bind(builder))
      builder.exec = wrapDBOperation(this, builder.exec.bind(builder))
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
  typeforce(types.item, item)
  return this._write('create', item, options)
}

DynamoTable.prototype.update = function (item, options) {
  return this._write('update', item, options)
}

DynamoTable.prototype._write = co(function* (method, item, options) {
  yield this._tableExistsPromise
  const { model, maxItemSize } = this
  const { min, diff, isMinified } = minify({ model, item, maxSize: maxItemSize })
  const result = yield this.table[method](min, options)
  return extend(result.toJSON(), diff)
})

DynamoTable.prototype.batchPut = co(function* (items, options={}) {
  typeforce(typeforce.arrayOf(types.item), items)

  yield this._tableExistsPromise
  const minified = items.map(item => {
    const { model, maxItemSize } = this
    return minify({ model, item, maxSize: maxItemSize })
  })

  let mins = minified.map(({ min }) => min)
  if (!options.docClient) {
    options.docClient = this.docClient
  }

  let batch
  while (mins.length) {
    batch = mins.slice(0, 25)
    mins = mins.slice(25)
    yield this._batchPut(batch, options)
  }

  return items
})

DynamoTable.prototype._batchPut = co(function* (items, backoffOptions={}) {
  const params = {
    RequestItems: {
      [this.name]: items.map(Item => ({
        PutRequest: { Item }
      }))
    }
  }

  if (!params.ReturnConsumedCapacity) {
    params.ReturnConsumedCapacity = 'TOTAL'
  }

  const {
    backoff=defaultBackoffFunction,
    maxTries=6
  } = backoffOptions

  let tries = 0
  let start = Date.now()
  let time = 0
  let failed
  while (tries < maxTries) {
    let result = yield this.docClient.batchWrite(params).promise()
    failed = result.UnprocessedItems
    if (!(failed && Object.keys(failed).length > 0)) return

    params.RequestItems = failed
    yield wait(backoff(tries++))
  }

  const err = new Error('batch put failed')
  err.failed = failed
  err.attempts = tries
  throw err
})

DynamoTable.prototype.destroy = co(function* (key, options) {
  yield this._tableExistsPromise
  const result = yield this.table.destroy(key, options)
  return result.toJSON()
})

DynamoTable.prototype.search = function (options) {
  options = shallowClone(options)
  options.table = this
  options.model = this.model
  return filterDynamoDB(options)
}

function wrapDBOperation (dynamoTable, fn) {
  const { model, objects } = dynamoTable
  const promisified = co(function* (...args) {
    yield dynamoTable._tableExistsPromise
    const result = yield promisify(fn).apply(dynamoTable, args)
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

  return function (...args) {
    const callback = args.pop()
    Promise.resolve(promisified(...args))
      .catch(callback)
      .then(result => callback(null, result))
  }
}

const maybeInflate = co(function* (dynamoTable, instance) {
  if (instance.get(minifiedFlag)) {
    const link = instance.get(hashKey)
    const full = yield dynamoTable.objects.get(link)
    instance.set(full)
  }

  return instance
})

function jitter (val, percent) {
  // jitter by val * percent
  // eslint-disable-next-line no-mixed-operators
  return val * (1 + 2 * percent * Math.random() - percent)
}

function defaultBackoffFunction (retryCount) {
  const delay = Math.pow(2, retryCount) * 500
  return Math.min(jitter(delay, 0.1), 10000)
}

function wait (millis) {
  return new Promise(resolve => setTimeout(resolve, millis))
}

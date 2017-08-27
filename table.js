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
const validateResource = require('@tradle/validate-resource')
const { SIG } = require('@tradle/constants')
const BaseObjectModel = require('@tradle/models')['tradle.Object']
const minify = require('./minify')
const filterDynamoDB = require('./filter-dynamodb')
const metadataTypes = toJoi({
  model: BaseObjectModel
})

const RESOLVED = Promise.resolve()
const { hashKey, minifiedFlag, defaultIndexes } = require('./constants')
const {
  getTableName,
  getIndexes,
  runWithBackoffOnTableNotExists,
  runWithBackoffWhile,
  waitTillActive
} = require('./utils')

const types = {
  dated: typeforce.compile({
    _time: typeforce.oneOf(typeforce.String, typeforce.Number),
  }),
  signed: typeforce.compile({
    _author: typeforce.String,
    _link: typeforce.String,
    [SIG]: typeforce.String
  })
}

module.exports = DynamoTable

function DynamoTable (opts) {
  const {
    joi,
    models,
    model,
    objects,
    prefix,
    suffix,
    maxItemSize,
    docClient,
    createIfNotExists=true,
    requireSigned=true
  } = opts

  bindAll(this)

  if (!(joi && model)) {
    throw new Error('joi and model are required')
  }

  this.opts = opts
  if (createIfNotExists) {
    let promise
    Object.defineProperty(this, '_tableCreateIfNotExistsPromise', {
      get: () => {
        if (!promise) {
          promise = this._maybeCreate()
        }

        return promise
      },
      set: val => {
        promise = val
      }
    })
  } else {
    this._tableCreateIfNotExistsPromise = RESOLVED
  }

  this.name = opts.tableName || getTableName({ model, prefix, suffix })

  const tableDef = {
    hashKey,
    tableName: this.name,
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
    include: [
      'createTable',
      'deleteTable',
      'describeTable',
      'create',
      'get',
      'update',
      'destroy'
    ]
  })

  ;['scan', 'query'].forEach(op => {
    this[op] = (...args) => {
      const builder = table[op](...args)
      // const exec = promisify(builder.exec.bind(builder))
      builder.exec = this._wrapDBOperation(builder.exec.bind(builder))
      return builder
    }
  })
}

DynamoTable.prototype.info = co(function* () {
  try {
    return yield this.table.describeTable()
  } catch (err) {
    if (err.name !== 'ResourceNotFoundException') {
      throw err
    }
  }
})

// DynamoTable.prototype.exists = co(function* () {
//   if (this._created) return true

//   try {
//     yield this.info()
//     return true
//   } catch (err) {
//     if (err.name !== 'ResourceNotFoundException') {
//       throw err
//     }

//     return false
//   }
// })

DynamoTable.prototype._maybeCreate = co(function* () {
  const info = yield this.info()
  if (info) {
    if (info.TableStatus === 'ACTIVE') return

    yield this.waitTillActive()
    this._debug('table already exists, not re-creating')
    return
  }

  try {
    yield this.create()
    yield this.waitTillActive()
    this._debug(`created table`)
  } catch (err) {
    // should have been taken care of by exists()
    // but just in case
    if (err.code !== 'ResourceInUseException') {
      this._tableCreateIfNotExistsPromise = null
      this._debug('failed to create table', err)
      throw err
    }
  }
})

DynamoTable.prototype.waitTillActive = co(function* () {
  if (!this._active) {
    yield waitTillActive(this.table)
    this._active = true
  }
})

DynamoTable.prototype.create = co(function* () {
  yield runWithBackoffWhile(() => this.table.createTable(), {
    shouldTryAgain: err => err.name === 'LimitExceededException'
  })

  this._created = true
})

DynamoTable.prototype._getMin = function (link) {
  typeforce(typeforce.String, link)
  return this.table.get(link)
}

DynamoTable.prototype.get = co(function* (link) {
  typeforce(typeforce.String, link)
  const info = yield this.info()
  if (isEmptyTable(info)) return

  // don't fetch directly from objects
  // as the item may have been deleted from the table
  // return this.objects.get(link)
  const instance = yield this._getMin(link)
  if (!instance) return null

  return yield maybeInflate(this, instance.toJSON())
})

DynamoTable.prototype.latest = co(function* (permalink) {
  typeforce(typeforce.String, permalink)

  const result = yield this.search({
    orderBy: {
      property: '_time',
      desc: true
    },
    limit: 1,
    filter: {
      EQ: {
        _permalink: permalink
      }
    }
  })

  if (result && result.items.length) {
    return yield maybeInflate(this, result.items[0])
  }

  return null
})

DynamoTable.prototype.put = function (item, options) {
  return this._write('create', item, options)
}

DynamoTable.prototype.merge = function (item, options) {
  return this._write('update', item, options)
}

DynamoTable.prototype._write = co(function* (method, item, options) {
  const { model, maxItemSize } = this.opts
  this._validateResource(item)

  yield this._tableCreateIfNotExistsPromise
  const { min, diff, isMinified } = minify({ model, item, maxSize: maxItemSize })
  const result = yield runWithBackoffOnTableNotExists(() => {
    return this.table[method](min, options)
  })

  this._debug(`"${method}" ${item[hashKey]} successfully`)
  return extend(result.toJSON(), diff)
})

DynamoTable.prototype._validateResource = function (item) {
  const { models, model, requireSigned } = this.opts

  typeforce(types.dated, item)
  if (requireSigned) {
    typeforce(types.signed, item)
  }

  validateResource({ models, model, resource: item })
}

DynamoTable.prototype._debug = function (...args) {
  args.unshift(this.opts.model.id)
  return debug(...args)
}

DynamoTable.prototype.batchPut = co(function* (items, options={}) {
  const { model, maxItemSize } = this.opts
  items.forEach(resource => this._validateResource(resource))

  yield this._tableCreateIfNotExistsPromise
  const minified = items.map(item => {
    return minify({ model, item, maxSize: maxItemSize })
  })

  let mins = minified.map(({ min }) => min)
  let batch
  while (mins.length) {
    batch = mins.slice(0, 25)
    mins = mins.slice(25)
    yield this._batchPut(batch, options)
    this._debug(`batchPut ${batch.length} items successfully`)
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

  const { docClient } = this.opts

  let tries = 0
  let start = Date.now()
  let time = 0
  let failed
  while (tries < maxTries) {
    let result = yield runWithBackoffOnTableNotExists(() => {
      return docClient.batchWrite(params).promise()
    })

    failed = result.UnprocessedItems
    if (!(failed && Object.keys(failed).length)) return

    this._debug(`batchPut partially failed, retrying`)
    params.RequestItems = failed
    yield wait(backoff(tries++))
  }

  const err = new Error('batch put failed')
  err.failed = failed
  err.attempts = tries
  throw err
})

DynamoTable.prototype.del = co(function* (link, options) {
  const info = yield this.info()
  if (isEmptyTable(info)) return

  yield this._tableCreateIfNotExistsPromise
  yield this.table.destroy(link, options)
  this._debug(`deleted ${link}`)
})

DynamoTable.prototype.search = co(function* (options) {
  const info = yield this.info()
  if (isEmptyTable(info)) {
    return { items: [] }
  }

  options = shallowClone(options)
  options.table = this
  options.model = this.opts.model
  const results = yield filterDynamoDB(options)
  this._debug(`search returned ${results.items.length} results`)
  results.items = yield Promise.all(results.items.map(item => {
    return maybeInflate(this, item, options)
  }))

  return results
})

DynamoTable.prototype.destroy = co(function* () {
  yield this.table.deleteTable()
  this._active = false
  this._created = false
})

DynamoTable.prototype._wrapDBOperation = function (fn) {
  const self = this
  const { model, objects } = this.opts
  const promisified = co(function* (...args) {
    yield self._tableCreateIfNotExistsPromise
    const result = yield promisify(fn).apply(self, args)
    if (!result) return result

    const { Item, Items } = result
    if (Item) {
      result.Item = Item.toJSON()
      yield maybeInflate(self, result.Item)
    } else if (Items) {
      result.Items = Items.map(Item => Item.toJSON())
      yield Promise.all(result.Items.map(Item => {
        return maybeInflate(self, Item)
      }))
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

const maybeInflate = co(function* (dynamoTable, item, options={}) {
  const cut = item[minifiedFlag]
  if (cut && cut.length) {
    const { select } = options
    if (select) {
      const needsInflate = cut.some(prop => prop in options.select)
      if (!needsInflate) return item
    }

    const link = item[hashKey]
    const full = yield dynamoTable.objects.get(link)
    extend(item, full)
  }

  return item
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

function isEmptyTable (info) {
  return !info || info.Table.TableStatus !== 'ACTIVE'
}

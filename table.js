const typeforce = require('typeforce')
const dynogels = require('dynogels')
const toJoi = require('@tradle/schema-joi')
const validateResource = require('@tradle/validate-resource')
const { TYPE, SIG } = require('@tradle/constants')
const BaseObjectModel = require('@tradle/models')['tradle.Object']
const Errors = require('./errors')
const minify = require('./minify')
const filterDynamoDB = require('./filter-dynamodb')
const metadataTypes = toJoi({
  model: BaseObjectModel
})

const RESOLVED = Promise.resolve()
const { minifiedFlag } = require('./constants')
const {
  co,
  promisify,
  debug,
  extend,
  shallowClone,
  clone,
  omit,
  pick,
  bindAll,
  getValues,
  getTableName,
  getIndexes,
  traverse,
  runWithBackoffOnTableNotExists,
  runWithBackoffWhile,
  waitTillActive,
  getModelPrimaryKeys,
  getResourcePrimaryKeys
} = require('./utils')

const types = {
  dated: typeforce.compile({
    _time: typeforce.Number
  }),
  signed: typeforce.compile({
    _author: typeforce.String,
    _link: typeforce.String,
    [SIG]: typeforce.String
  })
}

module.exports = DynamoTable

function DynamoTable (opts) {
  opts = shallowClone(opts)
  const {
    models,
    model,
    objects,
    prefix,
    suffix,
    maxItemSize,
    docClient,
    createIfNotExists=true,
    requireSigned=true,
    defaultReadOptions={},
    hashKey,
    rangeKey,
    indexes
  } = opts

  bindAll(this)

  if (!model) {
    throw new Error('model is required')
  }

  const {
    joi=toJoi({ models, model })
  } = opts

  this.primaryKeys = hashKey
    ? { hashKey, rangeKey }
    : getModelPrimaryKeys(model)

  this.hashKey = this.primaryKeys.hashKey
  this.rangeKey = this.primaryKeys.rangeKey
  this.opts = opts
  this.opts.defaultReadOptions = defaultReadOptions
  if (!this.opts.objects) {
    if (maxItemSize && maxItemSize < Infinity) {
      throw new Error('"maxItemSize" may only be specified if "objects" is provided')
    }
  }

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

  const tableDef = extend({
    tableName: this.name,
    timestamps: true,
    createdAt: false,
    updatedAt: '_dateUpdated',
    schema: extend({}, joi, metadataTypes),
    indexes: indexes || getIndexes(model),
    validation: {
      allowUnknown: true
    }
  }, this.primaryKeys)

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
  if (this._info) return this._info

  try {
    const info = yield this.table.describeTable()
    if (info.Table.TableStatus === 'ACTIVE') {
      this._info = info
    }

    return info
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
  delete this._info
  yield runWithBackoffWhile(() => this.table.createTable(), {
    shouldTryAgain: err => err.name === 'LimitExceededException'
  })

  this._created = true
})

DynamoTable.prototype._getPrimaryKeys = function (props) {
  let hashKey, rangeKey
  if (typeof props === 'object') {
    hashKey = props[this.primaryKeys.hashKey]
    rangeKey = props[this.primaryKeys.rangeKey]
  } else {
    hashKey = props
  }

  return { hashKey, rangeKey }
}

DynamoTable.prototype._getMin = function (primaryKeys, opts={}) {
  const { hashKey, rangeKey } = primaryKeys
  opts = shallowClone(this.opts.defaultReadOptions, opts)
  return this.table.get(hashKey, rangeKey, opts)
    .then(result => {
      if (!result) {
        throw new Errors.NotFound(`primaryKeys: ${JSON.stringify(primaryKeys)}`)
      }

      return result
    })
}

DynamoTable.prototype.get = co(function* (primaryKeys) {
  const info = yield this.info()
  if (!isActive(info)) return

  const { hashKey, rangeKey } = this._getPrimaryKeys(primaryKeys)
  if (this.primaryKeys.hashKey === '_link') {
    return this.opts.objects.get(hashKey)
  }

  const instance = yield this._getMin({ hashKey, rangeKey })
  return yield this._maybeInflate(instance.toJSON())
})

DynamoTable.prototype.latest = co(function* (permalink) {
  typeforce(typeforce.String, permalink)
  if (this.hashKey === '_permalink') {
    return this.get(permalink)
  }

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
    return yield this._maybeInflate(result.items[0])
  }

  throw new Errors.NotFound('permalink: ' + permalink)
})

DynamoTable.prototype.getVersions = co(function* ({ permalink }) {
  const { items } = yield this.find({
    select: ['_link'],
    filter: {
      EQ: {
        _permalink: permalink
      }
    }
  })

  return items
})

DynamoTable.prototype.deleteAllVersions = co(function* ({ permalink }) {
  const versions = yield this.getVersions({ permalink })
  return Promise.all(versions.map(({ _link }) => {
    return this.del({
      [TYPE]: this.opts.model.id,
      _link
    })
  }))
})

// DynamoTable.prototype.setLatest = function (item) {
//   // if (this.primaryKeys.hashKey !== '_permalink') {
//   //   throw new Error('this operation is only for "hashKey" === "_permalink"')
//   // }

//   const time = item.time || item._time
//   if (!time) {
//     throw new Error('expected "time"')
//   }

//   const options = {
//     ConditionExpression: '#time < :time',
//     ExpressionAttributeNames: {
//       '#time' : 'id'
//     },
//     ExpressionAttributeValues: {
//       ':time' : item._time || item.time
//     }
//   }

//   return this._write('update', item, options)
// }

DynamoTable.prototype.put = function (item, options={}) {
  if (this.hashKey === '_permalink') {
    if (Object.keys(options).length) {
      throw new Error('"options" not supported for hashKey _permalink')
    }

    options = {
      ConditionExpression: '#link = :link OR attribute_not_exists(#permalink) OR #time < :time',
      ExpressionAttributeNames: {
        '#time' : '_time',
        '#permalink': '_permalink',
        '#link': '_link',
      },
      ExpressionAttributeValues: {
        ':time' : item._time,
        ':link': item._link
      }
    }
  }

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

  const primaryKeys = getResourcePrimaryKeys({ model, resource: item })
  this._debug(`"${method}" ${JSON.stringify(primaryKeys)} successfully`)
  return extend(result.toJSON(), diff)
})

DynamoTable.prototype._validateResource = function (item) {
  const self = this
  const { models, model, requireSigned } = this.opts

  if (item[TYPE] !== model.id) {
    throw new Error(`expected ${TYPE} ${model.id}, got ${item[TYPE]}`)
  }

  typeforce(types.dated, item)
  if (requireSigned) {
    typeforce(types.signed, item)
  }

  validateResource({ models, model, resource: item })
  traverse(item).forEach(function (value) {
    if (value === '') {
      self._debug(
        `object contains empty string at path ${this.path.join('.')}`,
        JSON.stringify(item, null, 2)
      )

      throw new Error('object cannot contain empty string values')
    }
  })
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
  debug(`putting batch of ${items.length}`)

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
      debug('attempting batchWrite')
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

DynamoTable.prototype.del = co(function* (primaryKeys, options) {
  const info = yield this.info()
  if (!isActive(info)) return

  yield this._tableCreateIfNotExistsPromise
  const { hashKey, rangeKey } = this._getPrimaryKeys(primaryKeys)
  yield this.table.destroy(hashKey, rangeKey, options)
  this._debug(`deleted ${JSON.stringify(primaryKeys)}`)
})

DynamoTable.prototype.find =
DynamoTable.prototype.search = co(function* (options) {
  const info = yield this.info()
  if (!isActive(info)) {
    return { items: [] }
  }

  options = shallowClone(options, this.primaryKeys)
  const { filter } = options
  if (filter && filter.EQ) {
    options.filter = clone(filter)
    options.filter.EQ = omit(filter.EQ, [TYPE])
  }

  options.table = this
  options.model = this.opts.model
  options.models = this.opts.models
  if (!('consistentRead' in options)) {
    options.consistentRead = this.opts.defaultReadOptions.consistentRead
  }

  const results = yield filterDynamoDB(options)
  this._debug(`search returned ${results.items.length} results`)
  results.items = yield Promise.all(results.items.map(item => {
    return this._maybeInflate(item, options)
  }))

  return results
})

DynamoTable.prototype.findOne = co(function* (options) {
  options = shallowClone(options)
  options.limit = 1
  const { items=[] } = yield this.search(options)
  if (!items.length) {
    throw new Errors.NotFound(`query: ${JSON.stringify(options)}`)
  }

  return items[0]
})

DynamoTable.prototype.destroy = co(function* () {
  delete this._info
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
      yield self._maybeInflate(result.Item)
    } else if (Items) {
      result.Items = Items.map(Item => Item.toJSON())
      yield Promise.all(result.Items.map(Item => {
        self._maybeInflate(Item)
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

DynamoTable.prototype._maybeInflate = co(function* (item, options={}) {
  const { force, select } = options
  const cut = item[minifiedFlag]
  if (force || (cut && cut.length)) {
    if (select) {
      const needsInflate = cut.some(prop => select.includes(prop))
      if (!needsInflate) return item
    }

    item = yield this.inflate(item)
  }

  return item
})

DynamoTable.prototype.inflate = co(function* (item) {
  const link = item._link
  const full = yield this.opts.objects.get(link)
  item = shallowClone(item, full)
  delete item[minifiedFlag]
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

function isActive (info) {
  return info && info.Table.TableStatus === 'ACTIVE'
}

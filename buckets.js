const { EventEmitter } = require('events')
const inherits = require('inherits')
const levenshtein = require('fast-levenshtein')
const clone = require('xtend')
const extend = require('xtend/mutable')
const co = require('co').wrap
const dynogels = require('dynogels')
const { TYPE } = require('@tradle/constants')
const { isInstantiable } = require('@tradle/validate-resource').utils
const toJoi = require('@tradle/schema-joi')
const BaseObjectModel = require('@tradle/models')['tradle.Object']
const promisify = require('pify')
const { separator, minifiedFlag } = require('./constants')
const { minBy } = require('./utils')
const DONT_PREFIX = Object.keys(BaseObjectModel.properties)
const metadataTypes = toJoi({
  model: BaseObjectModel
})

function getUniquePrefix (type) {
  return sha256(type).slice(0, 6)
}

function prefixKeys (obj, prefix, skip=[]) {
  const prefixed = {}
  for (let key in obj) {
    if (!skip.includes(key)) {
      prefixed[prefixString(key, prefix)] = obj[key]
    }
  }

  return prefixed
}

// function prefixValues (obj, prefix) {
//   const prefixed = {}
//   for (let key in obj) {
//     if (!DONT_PREFIX.includes(key)) {
//       prefixed[key] = prefixString(obj[key], prefix)
//     }
//   }

//   return prefixed
// }

function unprefixKeys (obj, prefix, skip) {
  const unprefixed = {}
  for (let key in obj) {
    if (!skip.includes(key)) {
      unprefixed[unprefixString(key, prefix)] = obj[key]
    }
  }

  return unprefixed
}

function prefixString (str, prefix) {
  return str + separator + prefix
}

function unprefixString (str, prefix) {
  const start = prefix + separator
  if (str.startsWith(start)) {
    throw new Error(`expected string "${str}" to start with ${start}`)
  }

  return str.slice(start.length)
}

function distance (a, b) {
  return levenshtein(a, b)
}

function getClosestBucket (str, buckets) {
  const hash = sha256(str)
  return minBy(buckets, candidate => distance(candidate, hash))
}

function sha256 (data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}

function getTypePrefix (type, bucket) {
  return type
}

function Bucket ({ name, models, objects }) {
  EventEmitter.call(this)

  this.name = name
  this.models = models
  this.objects = objects
  this.subset = {}
  this.indexes = []
  this._prefix = {}

  let table
  // invalidate cached table
  this.on('def:update', () => table = null)

  Object.defineProperty(this, 'table', {
    get() {
      if (!table) {
        table = this._defineTable()
      }

      return table
    }
  })
}

inherits(Bucket, EventEmitter)

Bucket.prototype._defineTable = function () {
  if (!this.tableDef) {
    throw new Error('this bucket has no models! Use "addModel" to add some')
  }

  table = dynogels.define(model.id, this.tableDef)
  table = promisify(table, {
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

Bucket.prototype._prefixProperties = function (item) {
  return prefixKeys(item, this.getPrefix(item), DONT_PREFIX)
}

Bucket.prototype._unprefixProperties = function (item) {
  return unprefixKeys(item, this.getPrefix(item), DONT_PREFIX)
}

Bucket.prototype._wrapDBOperation = function (fn) {
  const { model, objects } = this.opts
  return co(function* (...args) {
    const result = yield promisify(fn).apply(this, args)
    if (!result) return result

    const { Item, Items } = result
    if (Item) {
      result.Item = Item.toJSON()
      result.Item = this._unprefixProperties(result.Item)
      yield this._maybeInflate(result.Item)
    } else if (Items) {
      result.Items = Items
        .map(Item => Item.toJSON())
        .map(item => this._unprefixKeys(item))

      yield Promise.all(result.Items.map(Item => this._maybeInflate(Item)))
    }

    return result
  }).bind(this)

  // return function (...args) {
  //   const callback = args.pop()
  //   Promise.resolve(promisified(...args))
  //     .catch(callback)
  //     .then(result => callback(null, result))
  // }
}

Bucket.prototype._maybeInflate = co(function* (item, options={}) {
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

Bucket.prototype.inflate = co(function* (item) {
  const link = item._link
  const full = yield this.opts.objects.get(link)
  item = shallowClone(item, full)
  delete item[minifiedFlag]
  return item
})

Bucket.prototype.distance = function (str) {
  return this.distanceRaw(sha256(str))
}

Bucket.prototype.distanceRaw = function (str) {
  return distance(str, this.name)
}

Bucket.prototype.getPrefix = function (type) {
  if (typeof type === 'object') {
    type = object[TYPE]
  }

  if (!this._prefix[type]) {
    this._prefix[type] = getUniquePrefix(type)
  }

  return this._prefix[type]
}

Bucket.prototype.prefix = function (item) {
  return prefixKeys(item, this.getPrefix(item[TYPE]))
}

Bucket.prototype.unprefix = function (item) {
  return unprefixKeys(item, this.getPrefix(item[TYPE]))
}

Bucket.prototype.addModel = function ({ model, indexes }) {
  this.subset[model.id] = model
  if (!(indexes && indexes.length)) return

  this.indexes = this.indexes.concat(indexes.map(index => {
    return clone(index, {
      hashKey: prefixString(index.hashKey)
      rangeKey: index.rangeKey && prefixString(index.rangeKey)
    })
  }))

  this.tableDef = {
    hashKey: '_type',
    rangeKey: '_permalink',
    tableName: this.name,
    timestamps: true,
    createdAt: false,
    updatedAt: '_dateUpdated',
    schema: metadataTypes,
    indexes: this.indexes,
    validation: {
      allowUnknown: true
    }
  }

  this.emit('def:update')
}

Bucket.prototype.put = function (item) {
  const type = item[TYPE]
  const model = this.models[type]
  if (!model) throw new Error(`model not found: ${type}`)

  item = prefixKeys(item, type, DONT_PREFIX)

  let options
  const primaryKeys = getModelPrimaryKeys(model)
  if (primaryKeys.hashKey === '_permalink') {
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

  this.table.put(item, options)
}

function Buckets ({ names, models, objects }) {
  this.buckets = names.map(name => new Bucket({ name, models, objects }))
  for (let id in models) {
    let model = models[id]
    if (isInstantiable(model)) {
      this.choose(id).addModel({ model })
    }
  }
}

Buckets.prototype.choose = function (str) {
  const hash = sha256(str)
  return _.minBy(this.buckets, bucket => bucket.distanceRaw(hash))
}

module.exports = {
  Buckets,
  Bucket
}

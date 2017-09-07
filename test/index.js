const crypto = require('crypto')
const test = require('tape')
const co = require('co').wrap
const clone = require('clone')
const dynogels = require('dynogels')
const { TYPE, SIG, PREVLINK, PERMALINK } = require('@tradle/constants')
const buildResource = require('@tradle/build-resource')
const models = require('@tradle/merge-models')()
  .add(require('@tradle/models').models)
  .get()

const { defaultOrderBy } = require('../constants')
const {
  debug,
  sortResults,
  wait,
  runWithBackoffOnTableNotExists
} = require('../utils')

dynogels.log = {
  info: debug,
  warn: debug,
  level: 'info'
}

const fixtures = require('./fixtures')
const formRequests = fixtures
  .filter(fixture => fixture[TYPE] === 'tradle.FormRequest')
  .slice(0, 20)

const photoIds = fixtures
  .filter(fixture => fixture[TYPE] === 'tradle.PhotoID')
  .slice(0, 20)

sortResults({ results: formRequests, orderBy: defaultOrderBy })

const endpoint = 'http://localhost:4569'
const { AWS } = dynogels

AWS.config.update({
  // localstack
  endpoint,
  region: 'us-east-1',
  accessKeyId: 'YOURKEY',
  secretAccessKey: 'YOURSECRET',
})

const docClient = new AWS.DynamoDB.DocumentClient({ endpoint })
const objects = {
  get: link => {
    const match = formRequests.find(formRequest => formRequest._link === link)
    if (match) return match

    throw new Error('NotFound')
  }
}

const tradleDynamo = require('../')
const tables = tradleDynamo.createTables({ objects, models, maxItemSize: 1000, docClient })
const table = tables['tradle.FormRequest']
const db = tradleDynamo.db({ tables })

test('sortResults', function (t) {
  const asc = sortResults({
    results: formRequests.slice(),
    orderBy: { property: 'form' }
  })

  t.ok(asc.every((item, i) => {
    return i === 0 || item.form >= asc[i - 1].form
  }), 'sort asc')

  const desc = sortResults({
    results: formRequests.slice(),
    orderBy: { property: 'form', desc: true }
  })

  t.ok(desc.every((item, i) => {
    return i === 0 || item.form <= desc[i - 1].form
  }), 'sort desc')

  // nested
  const ascById = sortResults({
    results: photoIds.slice(),
    orderBy: { property: 'documentType.id' }
  })

  t.ok(ascById.every((item, i) => {
    return i === 0 ||
      item.documentType.id >= ascById[i - 1].documentType.id
  }), 'sort by nested prop')

  // fallback to default
  const fallback = sortResults({
    results: photoIds.slice()
  })

  const expectedFallback = sortResults({
    results: photoIds.slice(),
    orderBy: defaultOrderBy
  })

  t.same(fallback, expectedFallback, 'fall back to default sorting order')
  t.end()
})

test('backoff after create', loudCo(function* (t) {
  const backoffOpts = {
    initialDelay: 50,
    maxDelay: 100,
    maxTime: 500
  }

  let expectedResult = 1
  let failsLeft = 3

  const errThatCausesBackoff = new Error('yay')
  errThatCausesBackoff.name = 'ResourceNotFoundException'

  const errThatCausesExit = new Error('nay')
  errThatCausesExit.name = 'ResourceIsStupidException'

  let result = yield runWithBackoffOnTableNotExists(co(function* () {
    if (failsLeft-- > 0) {
      throw errThatCausesBackoff
    }

    return expectedResult
  }), backoffOpts)

  t.equal(result, expectedResult)

  try {
    result = yield runWithBackoffOnTableNotExists(co(function* () {
      throw errThatCausesExit
    }), backoffOpts)

    t.fail('expected error')
  } catch (err) {
    t.equal(err, errThatCausesExit)
  }

  const start = Date.now()
  try {
    result = yield runWithBackoffOnTableNotExists(co(function* () {
      throw errThatCausesBackoff
    }), backoffOpts)

    t.fail('expected operation to time out')
  } catch (err) {
    t.equal(err.message, 'timed out')
    const time = Date.now() - start
    // expected delta should be around a tick (15-20ms)
    // but let's give it some room
    const delta = Math.abs(time - backoffOpts.maxTime)
    t.ok(delta < 100)
  }

  t.end()
}))

test('no autocreate on read/del', loudCo(function* (t) {
  try {
    yield table.destroy()
  } catch (err) {
    if (err.code !== 'ResourceNotFoundException') {
      throw err
    }
  }

  const { create } = table
  table.create = () => {
    t.fail('should not create table on read or del ops')
    return Promise.resolve()
  }

  t.notOk(yield table.get('some resource id'))
  t.same(yield table.search({
    filter: {
      EQ: {
        form: 'tradle.AboutYou'
      }
    }
  }), { items: [] })

  yield table.del('some resource id')

  // restore
  table.create = create
  t.end()
}))

test('load fixtures', loudCo(function* (t) {
  try {
    yield table.destroy()
  } catch (err) {
    if (err.code !== 'ResourceNotFoundException') {
      throw err
    }
  }

  yield table.batchPut(formRequests)
  const result = yield table.search()
  t.equal(result.items.length, formRequests.length)
  t.end()
}))

test('basic pagination', loudCo(function* (t) {
  const page1 = yield table.search({
    limit: 5
  })

  t.same(page1.items, formRequests.slice(0, 5))
  const page2 = yield table.search({
    after: page1.endPosition,
    limit: 5
  })

  t.same(page2.items, formRequests.slice(5, 10))
  const page3 = yield table.search({
    after: page2.endPosition
  })

  t.same(page3.items, formRequests.slice(10))
  t.end()
}))

test('orderBy', loudCo(function* (t) {
  const expected = formRequests.slice()
  const orderBy = {
    property: 'form'
  }

  sortResults({ results: expected, orderBy })

  const page1 = yield table.search({
    orderBy,
    limit: 5
  })

  t.same(page1.items, expected.slice(0, 5))
  const page2 = yield table.search({
    after: page1.endPosition,
    orderBy,
    limit: 5
  })

  t.same(page2.items, expected.slice(5, 10))
  const page3 = yield table.search({
    after: page2.endPosition,
    orderBy
  })

  t.same(page3.items, expected.slice(10))

  // and in reverse
  expected.reverse()
  orderBy.descending = true

  sortResults({ results: expected, orderBy })
  const desc1 = yield table.search({
    orderBy,
    limit: 5
  })

  t.same(desc1.items, expected.slice(0, 5))

  t.end()
}))

test('indexed props', loudCo(function* (t) {
  const _author = formRequests[0]._author
  const expected = formRequests.slice()
    .filter(fr => fr._author === _author)

  t.ok(expected.length >= 20)

  const orderBy = {
    property: '_author'
  }

  const filter = {
    EQ: { _author }
  }

  sortResults({ results: expected, orderBy })

  const page1 = yield table.search({
    orderBy,
    filter,
    limit: 5
  })

  t.same(page1.items, expected.slice(0, 5))
  const page2 = yield table.search({
    after: page1.endPosition,
    filter,
    orderBy,
    limit: 5
  })

  t.same(page2.items, expected.slice(5, 10))
  const page3 = yield table.search({
    after: page2.endPosition,
    filter,
    orderBy,
    // limit: 10
  })

  t.same(page3.items, expected.slice(10, 20))
  t.end()
}))

test('latest', loudCo(function* (t) {
  const v1 = formRequests[0]
  const v2 = clone(v1)
  v2[SIG] = crypto.randomBytes(128).toString('base64')
  v2[PERMALINK] = v2._permalink
  v2[PREVLINK] = v2._link
  buildResource.setVirtual(v2, {
    _time: Date.now(),
    _link: crypto.randomBytes(32).toString('hex')
  })

  yield table.put(v2)
  const {
    first,
    latest
  } = yield {
    first: yield table.get(v1._permalink),
    latest: yield table.latest(v1._permalink)
  }

  t.same(first, v1)
  t.same(latest, v2)
  yield table.del(v2._link)
  t.same(yield table.latest(v1._permalink), first)

  t.end()
}))

test('db', loudCo(function* (t) {
  const req = formRequests[0]
  const type = req[TYPE]
  const link = req._link
  const permalink = req._permalink
  t.same(yield db.get({ type, link }), req)
  t.same(yield db.latest({ type, permalink }), req)
  yield db.del({ type, link })

  t.notOk(yield db.get({ type, link }))
  t.notOk(yield db.latest({ type, permalink }))
  yield db.put(req)
  t.same(yield db.get({ type, link }), req)

  const searchResult = yield db.search({
    type,
    filter: {
      EQ: {
        form: req.form
      }
    }
  })

  const expectedSearchResult = formRequests.filter(({ form }) => form === req.form)
  t.same(searchResult.items, expectedSearchResult)

  t.end()
}))

function loudCo (gen) {
  return co(function* (...args) {
    try {
      return yield co(gen).apply(this, args)
    } catch (err) {
      console.error(err)
      throw err
    }
  })
}

function prettify (obj) {
  return JSON.stringify(obj, null, 2)
}

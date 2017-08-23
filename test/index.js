const test = require('tape')
const co = require('co').wrap
const dynogels = require('dynogels')
const models = require('@tradle/merge-models')()
  .add(require('@tradle/models').models)
  .get()

const { defaultOrderBy } = require('../constants')
const { sortResults } = require('../utils')
const formRequests = require('./fixtures')
  .filter(fixture => {
    return fixture._t === 'tradle.FormRequest'
  })
  .slice(0, 20)
  // .sort(createSort(defaultOrderBy))

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

const { createTables } = require('../')
const tables = createTables({ objects, models, maxItemSize: 1000, docClient })
const table = tables['tradle.FormRequest']

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

const crypto = require('crypto')
const test = require('tape')
const co = require('co').wrap
const clone = require('clone')
const dynogels = require('dynogels')
const { TYPE, SIG, PREVLINK, PERMALINK } = require('@tradle/constants')
const buildResource = require('@tradle/build-resource')
const mergeModels = require('@tradle/merge-models')
const models = mergeModels()
  .add(require('@tradle/models').models)
  .add(require('@tradle/custom-models'))
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
const db = tradleDynamo.db({
  objects,
  models,
  maxItemSize: 1000,
  docClient,
  validate: false,
  prefix: 'tradle-dynamodb-test-'
})

const { tables } = db
const table = tables['tradle.FormRequest']

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
  t.same(yield db.get({
    [TYPE]: type,
    _link: link
  }), req)

  t.same(yield db.latest({
    [TYPE]: type,
    _permalink: permalink
  }), req)

  yield db.del({
    [TYPE]: type,
    _link: link
  })

  try {
    yield db.get({
      [TYPE]: type,
      _link: link
    })

    t.fail('expected NotFound error')
  } catch (err) {
    t.equal(err.name, 'NotFound')
  }

  try {
    yield db.latest({
      [TYPE]: type,
      _permalink: permalink
    })

    t.fail('expected NotFound error')
  } catch (err) {
    t.equal(err.name, 'NotFound')
  }

  yield db.put(req)
  t.same(yield db.get({
    [TYPE]: type,
    _link: link
  }), req)

  const searchResult = yield db.search({
    filter: {
      EQ: {
        [TYPE]: type,
        form: req.form
      }
    }
  })

  const expectedSearchResult = formRequests.filter(({ form }) => form === req.form)
  t.same(searchResult.items, expectedSearchResult)

  t.end()
}))

test('filters', loudCo(function* (t) {
  const type = 'tradle.PhotoID'
  const photoIds = fixtures.filter(item => item[TYPE] === type)
  // const byType = groupByType(fixtures)
  yield db.batchPut(photoIds)
  // yield Object.keys(byType).map(type => {
  //   if (db.tables[type]) {
  //     return db.batchPut(byType[type])
  //   }

  //   return Promise.resolve()
  // })

  const orderBy = {
    property: '_time'
  }

  const orderByCombinations = getOrderByCombinations({
    properties: ['_time', '_author', '_link']
  })

  const tests = orderByCombinations.map(orderBy => co(function* () {
    const first = photoIds[0]
    let expected

    const startsWithStr = 'tradle.'
    expected = photoIds.filter(photoId => {
      return photoId.country.id.startsWith(startsWithStr)
    })

    sortResults({ results: expected, orderBy })

    const countryIdStartsWith = yield db.search({
      orderBy,
      filter: {
        EQ: {
          [TYPE]: type
        },
        STARTS_WITH: {
          'country.id': startsWithStr
        }
      }
    })

    t.same(countryIdStartsWith.items, expected, 'country.id STARTS_WITH')

    const minTime = photoIds[0]._time
    expected = photoIds.filter(photoId => {
      return photoId._time > minTime
    })

    sortResults({ results: expected, orderBy })

    const photoIdsGt = yield db.search({
      orderBy,
      filter: {
        EQ: {
          [TYPE]: type
        },
        GT: {
          _time: minTime
        }
      }
    })

    t.same(photoIdsGt.items, expected, '_time GT')

    const countries = ['tradle.Country_efe0530781364d08e8ab58e34fe8fffc2db3af39449242a95c0a3307826475da_efe0530781364d08e8ab58e34fe8fffc2db3af39449242a95c0a3307826475da']
    expected = photoIds.filter(photoId => {
      return countries.includes(photoId.country.id)
    })

    sortResults({ results: expected, orderBy })

    const photoIdsIn = yield db.search({
      orderBy,
      filter: {
        EQ: {
          [TYPE]: type
        },
        IN: {
          'country.id': countries
        }
      }
    })

    t.same(photoIdsIn.items, expected, 'countries IN')

    expected = []
    sortResults({ results: expected, orderBy })

    const photoIdsCountryNull = yield db.search({
      orderBy,
      filter: {
        EQ: {
          [TYPE]: type
        },
        NULL: {
          country: true
        }
      }
    })

    t.same(photoIdsCountryNull.items, expected, 'country null')

    expected = photoIds.slice()
    sortResults({ results: expected, orderBy })

    const photoIdsCountryNotNull = yield db.search({
      orderBy,
      filter: {
        EQ: {
          [TYPE]: type
        },
        NULL: {
          country: false
        }
      }
    })

    t.same(photoIdsCountryNotNull.items, expected, 'country not null')
  }))

  for (const test of tests) {
    yield test()
  }

  t.end()
}))

test('addModels', loudCo(function* (t) {
  const A_TYPE = 'mynamespace.modelA'
  db.addModels({
    A_TYPE: {
      type: 'tradle.Model',
      id: A_TYPE,
      title: 'A',
      properties: {
        a: {
          type: 'string'
        }
      }
    }
  })

  t.ok(A_TYPE in db.tables, 'models added dynamically')
  t.ok(A_TYPE in db.tables[A_TYPE].opts.models, 'latest models propagated in options to table')

  const a = {
    _link: 'alink',
    _time: 1505941645561,
    [TYPE]: A_TYPE,
    a: 'a'
  }

  yield db.put(a)
  t.same(yield db.get({
    [TYPE]: A_TYPE,
    _link: a._link
  }), a)

  t.end()
}))

test('custom primary keys', loudCo(function* (t) {
  const ALIEN_CLASSIFIER = 'mynamespace.Alien'
  const alienModel = {
    type: 'tradle.Model',
    id: ALIEN_CLASSIFIER,
    title: 'Alien Classifier',
    properties: {
      color: {
        type: 'string'
      },
      fingerCount: {
        type: 'number'
      },
      iq: {
        type: 'number'
      }
    },
    primaryKeys: {
      hashKey: 'color',
      rangeKey: 'fingerCount'
    }
  }

  db.addModels({
    [ALIEN_CLASSIFIER]: alienModel
  })

  const updatedModels = db.models
  const alien = buildResource({
      models: updatedModels,
      model: alienModel
    })
    .set({
      _time: Date.now(),
      color: '#0000ff',
      fingerCount: 50,
      iq: 1
    })
    .toJSON()

  yield db.put(alien)
  t.same(yield db.get(alien), alien)

  const searchResult = yield db.search({
    orderBy: {
      property: 'fingerCount'
    },
    filter: {
      EQ: {
        [TYPE]: ALIEN_CLASSIFIER,
        color: '#0000ff'
      },
      GT: {
        fingerCount: 10
      }
    }
  })

  t.same(searchResult.items, [alien])

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

function groupByType (items) {
  const byType = {}
  for (const item of items) {
    const type = item[TYPE]
    if (!byType[type]) {
      byType[type] = []
    }

    byType[type].push(item)
  }

  return byType
}

function getOrderByCombinations ({ properties }) {
  return properties.map(property => ([
    {
      property
    },
    {
      property,
      desc: true
    }
  ]))
  // flatten
  .reduce((arr, batch) => arr.concat(batch), [])
}

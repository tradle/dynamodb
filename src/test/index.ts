require('source-map-support').install()

import crypto = require('crypto')
import test = require('tape')
import dynogels = require('dynogels')
import { TYPE, SIG, PREVLINK, PERMALINK } from '@tradle/constants'
import buildResource = require('@tradle/build-resource')
import mergeModels = require('@tradle/merge-models')
const models = mergeModels()
  .add(require('@tradle/models').models)
  .add(require('@tradle/custom-models'))
  .get()

import { OrderBy } from '../types'
import minify from '../minify'
const { defaultOrderBy, defaultIndexes } = require('../constants')
const {
  debug,
  sortResults,
  wait,
  runWithBackoffOnTableNotExists
} = require('../utils')

// dynogels.log = {
//   info: debug,
//   warn: debug,
//   level: 'info'
// }

const fixtures = require('./fixtures')
const FORM_REQUEST = 'tradle.FormRequest'
const formRequests = fixtures
  .filter(fixture => fixture[TYPE] === FORM_REQUEST)
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
const objects = (function () {
  const cache = {}
  const api = {
    get: async (link) => {
      const match = cache[link]
      if (match) return match

      throw new Error('NotFound')
    },
    put: item => {
      cache[item._link] = item
    }
  }

  fixtures.forEach(api.put)
  return api
}())

import { DB } from '../'
let db
let table
let offset = Date.now()
let lastCreated = []

const cleanup = async () => {
  if (!lastCreated.length) return

  db = new DB({
    tableNames: lastCreated,
    tableOpts: {
      objects,
      models,
      maxItemSize: 4000,
      docClient,
      validate: false,
    }
  })

  await db.destroyTables()
}

const reload = async () => {
  await cleanup()
  const prefix = '' + (offset++)
  lastCreated = ['a', 'b', 'c', 'd', 'e'].map(name => prefix + name)
  db = new DB({
    tableNames: lastCreated,
    tableOpts: {
      objects,
      models,
      maxItemSize: 4000,
      docClient,
      validate: false,
    }
  })

  await db.createTables()
  await db.batchPut(formRequests)
  // table = db.tables[FORM_REQUEST]
  // await db.batchPut(formRequests)
}

test('minify (big values)', function (t) {
  const bigMsg = {
    [TYPE]: 'tradle.SimpleMessage',
    message: 'blah'.repeat(1000)
  }

  // fake table
  const table = {
    models,
    indexes: defaultIndexes
  }

  const minBigMsg = minify({
    table,
    item: bigMsg,
    maxSize: 1000
  })

  t.same(minBigMsg.diff, { message: bigMsg.message })
  t.same(minBigMsg.min, {
    [TYPE]: bigMsg[TYPE],
    _cut: ['message']
  })

  const smallMsg = {
    [TYPE]: 'tradle.SimpleMessage',
    message: 'blah'.repeat(100)
  }

  const minSmallMsg = minify({
    item: smallMsg,
    table,
    maxSize: 1000
  })

  t.same(minSmallMsg.diff, {})
  t.same(minSmallMsg.min, smallMsg)
  t.end()
})

test('minify (embedded media)', function (t) {
  const photoId = {
    [TYPE]: 'tradle.PhotoID',
    scan: {
      url: 'data:image/jpeg;base64,' + 'blah'.repeat(1000)
    }
  }

  // fake table
  const table = {
    models,
    indexes: defaultIndexes
  }

  const minPhotoId = minify({
    item: photoId,
    table,
    maxSize: 1000
  })

  t.same(minPhotoId.min._cut, ['scan'])
  t.end()
})

test('minify (optional props)', function (t) {
  // optional
  const thingy = {
    [TYPE]: 'tradle.Thingy',
    a: 'a'.repeat(99),
    b: 'b'.repeat(99)
  }

  const customModels = {
    ...models,
    [thingy[TYPE]]: {
      properties: {
        a: { type: 'string' },
        b: { type: 'string' }
      },
      required: [
        'a'
      ]
    }
  }

  // fake table
  const table = {
    models: customModels,
    indexes: defaultIndexes
  }

  const minThingy = minify({
    item: thingy,
    table,
    maxSize: 200
  })

  t.same(minThingy.min._cut, ['b'])
  t.end()
})

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

test('backoff after create', loudAsync(async (t) => {
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

  let result = await runWithBackoffOnTableNotExists(async () => {
    if (failsLeft-- > 0) {
      throw errThatCausesBackoff
    }

    return expectedResult
  }, backoffOpts)

  t.equal(result, expectedResult)

  try {
    result = await runWithBackoffOnTableNotExists(async () => {
      throw errThatCausesExit
    }, backoffOpts)

    t.fail('expected error')
  } catch (err) {
    t.equal(err, errThatCausesExit)
  }

  const start = Date.now()
  try {
    result = await runWithBackoffOnTableNotExists(async () => {
      throw errThatCausesBackoff
    }, backoffOpts)

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

test('basic pagination', loudAsync(async (t) => {
  await reload()
  const filter = {
    EQ: {
      [TYPE]: FORM_REQUEST
    }
  }

  const page1 = await db.find({
    filter,
    limit: 5
  })

  t.same(page1.items, formRequests.slice(0, 5))
  const page2 = await db.find({
    filter,
    after: page1.endPosition,
    limit: 5
  })

  t.same(page2.items, formRequests.slice(5, 10))
  const page3 = await db.find({
    filter,
    after: page2.endPosition
  })

  t.same(page3.items, formRequests.slice(10))
  t.end()
}))

test('orderBy', loudAsync(async (t) => {
  await reload()
  const filter = {
    EQ: {
      [TYPE]: FORM_REQUEST
    }
  }

  const expected = formRequests.slice()
  const orderBy:OrderBy = {
    property: 'form'
  }

  sortResults({ results: expected, orderBy })

  const page1 = await db.find({
    filter,
    orderBy,
    limit: 5
  })

  t.same(page1.items, expected.slice(0, 5))
  const page2 = await db.find({
    filter,
    after: page1.endPosition,
    orderBy,
    limit: 5
  })

  t.same(page2.items, expected.slice(5, 10))
  const page3 = await db.find({
    filter,
    after: page2.endPosition,
    orderBy
  })

  t.same(page3.items, expected.slice(10))

  // and in reverse
  expected.reverse()
  orderBy.desc = true

  sortResults({ results: expected, orderBy })
  const desc1 = await db.find({
    filter,
    orderBy,
    limit: 5
  })

  t.same(desc1.items, expected.slice(0, 5))

  t.end()
}))

test('indexed props', loudAsync(async (t) => {
  await reload()
  const _author = formRequests[0]._author
  const expected = formRequests.slice()
    .filter(fr => fr._author === _author)

  t.ok(expected.length >= 20)

  const orderBy = {
    property: '_time'
  }

  const filter = {
    EQ: {
      [TYPE]: FORM_REQUEST,
      _author
    }
  }

  sortResults({ results: expected, orderBy })

  const page1 = await db.find({
    orderBy,
    filter,
    limit: 5
  })

  t.same(page1.items, expected.slice(0, 5))
  const page2 = await db.find({
    after: page1.endPosition,
    filter,
    orderBy,
    limit: 5
  })

  t.same(page2.items, expected.slice(5, 10))
  const page3 = await db.find({
    after: page2.endPosition,
    filter,
    orderBy,
    // limit: 10
  })

  t.same(page3.items, expected.slice(10, 20))
  t.end()
}))

test('latest', loudAsync(async (t) => {
  await reload()
  const v1 = formRequests[0]
  await db.put(v1)

  const v2 = { ...v1 }
  v2[SIG] = crypto.randomBytes(128).toString('base64')
  v2[PERMALINK] = v2._permalink
  v2[PREVLINK] = v2._link
  buildResource.setVirtual(v2, {
    _time: v1._time - 1,
    _link: crypto.randomBytes(32).toString('hex')
  })

  try {
    await db.put(v2)
    t.fail('conditional check should have failed')
  } catch (err) {
    t.equals(err.name, 'ConditionalCheckFailedException')
  }

  buildResource.setVirtual(v2, {
    _time: v1._time + 1,
    _link: crypto.randomBytes(32).toString('hex')
  })

  await db.put(v2)
  t.same(await db.get({
    [TYPE]: FORM_REQUEST,
    _permalink: v2._permalink
  }), v2)

  t.end()
}))

// test('latest', loudAsync(async (t) => {
//   await reload()
//   const v1 = formRequests[0]
//   const v2 = clone(v1)
//   v2[SIG] = crypto.randomBytes(128).toString('base64')
//   v2[PERMALINK] = v2._permalink
//   v2[PREVLINK] = v2._link
//   buildResource.setVirtual(v2, {
//     _time: Date.now(),
//     _link: crypto.randomBytes(32).toString('hex')
//   })

//   objects.put(v2)
//   await db.put(v2)
//   const {
//     first,
//     latest
//   } = await {
//     first: await db.get(v1._permalink),
//     latest: await db.latest(v1._permalink)
//   }

//   t.same(first, v1)
//   t.same(latest, v2)
//   await db.del(v2._link)
//   t.same(await db.latest(v1._permalink), first)

//   objects.put(v2)
//   await db.put(v2)
//   const versions = await db.getVersions({ permalink: v1._permalink })
//   t.same(versions.sort(byLink), [v1, v2].sort(byLink))

//   await db.deleteAllVersions({ permalink: v1._permalink })
//   try {
//     const storedV1 = await db.get(v1._permalink)
//     t.fail('expected v1 to have been deleted')
//   } catch (err) {
//     t.notEqual(err.message.indexOf(v1._permalink), -1)
//   }

//   try {
//     const storedV2 = await db.get(v2._permalink)
//     t.fail('expected v2 to have been deleted')
//   } catch (err) {
//     t.notEqual(err.message.indexOf(v2._permalink), -1)
//   }

//   t.end()
// }))

test('db', loudAsync(async (t) => {
  await reload()
  const req = formRequests[0]
  const type = req[TYPE]
  const link = req._link
  const permalink = req._permalink
  t.same(await db.get({
    [TYPE]: type,
    _permalink: permalink
  }), req, 'db.get')

  t.same(await db.latest({
    [TYPE]: type,
    _permalink: permalink
  }), req, 'db.latest')

  await db.del({
    [TYPE]: type,
    _permalink: permalink
  })

  try {
    await db.get({
      [TYPE]: type,
      _permalink: permalink
    })

    t.fail('expected NotFound error')
  } catch (err) {
    t.equal(err.name, 'NotFound')
  }

  try {
    await db.latest({
      [TYPE]: type,
      _permalink: permalink
    })

    t.fail('expected NotFound error')
  } catch (err) {
    t.equal(err.name, 'NotFound')
  }

  await db.put(req)
  t.same(await db.get({
    [TYPE]: type,
    _permalink: permalink
  }), req)

  const searchResult = await db.find({
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

test('filters', loudAsync(async (t) => {
  await reload()
  const type = 'tradle.PhotoID'
  const photoIds = fixtures.filter(item => item[TYPE] === type)
  // const byType = groupByType(fixtures)
  // photoIds.forEach(objects.put)
  await db.batchPut(photoIds)
  // await Object.keys(byType).map(type => {
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

  const tests = orderByCombinations.map(orderBy => async () => {
    const first = photoIds[0]
    let expected

    const startsWithStr = 'tradle.'
    expected = photoIds.filter(photoId => {
      return photoId.country.id.startsWith(startsWithStr)
    })

    sortResults({ results: expected, orderBy })

    const countryIdStartsWith = await db.find({
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

    const photoIdsGt = await db.find({
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

    const photoIdsIn = await db.find({
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

    const photoIdsCountryNull = await db.find({
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

    const photoIdsCountryNotNull = await db.find({
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
  })

  for (const test of tests) {
    await test()
  }

  t.end()
}))

test('addModels', loudAsync(async (t) => {
  await reload()
  const A_TYPE = 'mynamespace.modelA'
  db.addModels({
    [A_TYPE]: {
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

  t.ok(db.tables[A_TYPE], 'models added dynamically')
  t.ok(db.tables[A_TYPE].opts.models, 'latest models propagated in options to table')

  const a = {
    _link: 'alink',
    _permalink: 'alink',
    _time: 1505941645561,
    [TYPE]: A_TYPE,
    a: 'a'
  }

  await db.put(a)
  t.same(await db.get({
    [TYPE]: A_TYPE,
    _permalink: a._link
  }), a)

  t.end()
}))

test('custom primary keys', loudAsync(async (t) => {
  await reload()
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

  db.setExclusive({
    model: alienModel
  })

  await db.tables[ALIEN_CLASSIFIER].create()

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

  await db.put(alien)
  t.same(await db.get(alien), alien)

  const searchResult = await db.find({
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

test('cleanup', async (t) => {
  await cleanup()
  t.end()
})

function loudAsync (asyncFn) {
  return async (...args) => {
    try {
      return await asyncFn(...args)
    } catch (err) {
      console.error(err)
      throw err
    }
  }
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

function byLink (a, b) {
  return a._link < b._link ? -1 : a._link > b._link ? 1 : 0
}

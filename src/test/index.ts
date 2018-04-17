require('source-map-support').install()

import crypto from 'crypto'
import _ from 'lodash'
import test from 'tape'
import dynogels from 'dynogels'
import { TYPE, SIG, PREVLINK, PERMALINK } from '@tradle/constants'
import validateResource from '@tradle/validate-resource'
import buildResource from '@tradle/build-resource'
import mergeModels from '@tradle/merge-models'
const models = mergeModels()
  .add(require('@tradle/models').models)
  .add(require('@tradle/custom-models'))
  .get()

import { OrderBy } from '../types'
import minify from '../minify'
import * as defaults from '../defaults'
import { expandFilter } from '../filter-dynamodb'
import {
  defaultOrderBy,
  // defaultIndexes
} from '../constants'

import {
  debug,
  sortResults as rawSortResults,
  wait,
  runWithBackoffOnTableNotExists,
  getTableDefinitionForModel,
  getQueryInfo,
  toDynogelTableDefinition,
  getTemplateStringVariables,
  normalizeIndexedPropertyTemplateSchema
} from '../utils'

import {
  createDB as rawCreateDB,
  defaultIndexes
} from './utils'

const sortResults = opts => rawSortResults({
  defaultOrderBy,
  ...opts
})

dynogels.log = {
  info: debug,
  warn: debug,
  level: 'info'
}

const resources = require('./fixtures/resources.json')
const tableSchema = require('./fixtures/table-schema.json')
const def = toDynogelTableDefinition({
  ...tableSchema,
  TableName: 'test-resources-' + Date.now()
})

const { hashKey, rangeKey } = def
const tableKeys = [hashKey, rangeKey]
  .concat(_.flatten(def.indexes.map(def => [def.hashKey, def.rangeKey])))
  .filter(_.identity)

const FORM_REQUEST = 'tradle.FormRequest'
const FORM_REQUEST_MODEL = models[FORM_REQUEST]
const formRequests = resources
  .filter(r => r[TYPE] === FORM_REQUEST)
  .slice(0, 20)

const photoIds = resources
  .filter(r => r[TYPE] === 'tradle.PhotoID')
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

  resources.forEach(api.put)
  return api
}())

import { DB, Table, createTable, createModelStore } from '../'

let db:DB
let table
let offset = Date.now()
let lastCreated = []

const createDB = (indexes?) => {
  return rawCreateDB({
    tableNames: lastCreated,
    docClient,
    objects,
    models,
    indexes
  })
}

const cleanup = async (indexes?) => {
  if (!lastCreated.length) return

  db = createDB(indexes)
  await db.destroyTables()
}

const validResources = resources.filter(resource => {
  try {
    validateResource({ models, resource })
    return true
  } catch (err) {}
})

const numTables = 1
const reload = async (indexes?) => {
  await cleanup(indexes)
  const prefix = '' + (offset++)
  lastCreated = _.range(0, numTables).map(i => prefix + i)
  db = createDB(indexes)
  await db.createTables()
  // await db.batchPut(validResources)
  await db.batchPut(formRequests)

  // table = db.tables[FORM_REQUEST]
  // await db.batchPut(formRequests)
}

// test.only('load', loudAsync(async (t) => {
//   await reload()
//   t.end()
// }))

test('key templates', t => {
  t.same([
    'a',
    ['a'],
    ['a', 'b'],
    '{a}{b}{c}',
    { hashKey: ['a', 'b'], rangeKey: '{a}{b}{c}' },
  ].map(normalizeIndexedPropertyTemplateSchema), [
    { hashKey: { template: '{a}' } },
    { hashKey: { template: '{a}' } },
    { hashKey: { template: '{a}{b}' } },
    { hashKey: { template: '{a}{b}{c}' } },
    { hashKey: { template: '{a}{b}' }, rangeKey: { template: '{a}{b}{c}' } },
  ])

  t.same(getTemplateStringVariables('{a}lala{b}'), ['a', 'b'])

  const model = {
    type: 'tradle.Model',
    id: 'tradle.Namey',
    title: 'Namey name',
    properties: {
      firstName: { type: 'string' },
      lastName: { type: 'string' },
      nickName: { type: 'string' },
      // firstName: { type: 'string' },
    },
    required: ['firstName', 'lastName'],
    indexes: [
      {
        hashKey: '{firstName} "Angry" {lastName}',
        rangeKey: ['lastName', 'firstName'],
      }
    ]
  }

  const models = { [model.id]: model }
  const table = createTable({
    objects,
    docClient,
    model,
    models,
    tableDefinition: tableSchema,
    derivedProps: tableKeys
  })

  table.storeResourcesForModel({ model })

  const derived = defaults.deriveProps({
    table,
    item: {
      [TYPE]: model.id,
      firstName: 'Bill S',
      lastName: 'Preston'
    },
    isRead: false
  })

  t.same(derived, {
    __r__: '_',
    __x0h__: 'tradle.Namey{Bill%20S} "Angry" {Preston}',
    __x0r__: '{Preston}{Bill%20S}'
  })

  t.same(defaults.parseDerivedProps({
    table,
    model,
    resource: derived
  }), {
    [TYPE]: model.id,
    firstName: 'Bill S',
    lastName: 'Preston'
  })

  t.end()
})

test('model store', loudAsync(async (t) => {
  let externalSource = models
  let i = 0
  const onMissingModel = async (id) => {
    i++
    store.addModels(_.pick(externalSource, ['tradle.Object', 'tradle.Seal']))
    return externalSource[id]
  }

  const store = createModelStore({
    onMissingModel
  })

  t.same(await store.get('tradle.Object'), externalSource['tradle.Object'])
  t.equal(i, 1)
  try {
    await store.get('dsahjdksa')
    t.fail('expected not found')
  } catch (err) {
    t.ok(/not found/i.test(err.message))
  }

  t.end()
}))

test('minify (big values)', function (t) {
  const bigMsg = {
    [TYPE]: 'tradle.SimpleMessage',
    message: 'blah'.repeat(1000),
    shortMessage: 'blah'.repeat(10)
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
    shortMessage: bigMsg.shortMessage,
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

test('minify (retain resource values)', function (t) {
  const id = 'some.thingy.Thing'
  const customModels = {
    ...models,
    [id]: {
      id,
      properties: {
        friend: {
          type: 'object',
          ref: 'tradle.Identity'
        }
      }
    }
  }

  // fake table
  const table = {
    models: customModels,
    indexes: defaultIndexes
  }

  const thingy = {
    [TYPE]: id,
    friend: {
      id: `${id}_abc_123`
    }
  }

  const minThingy = minify({
    item: thingy,
    table,
    maxSize: 1
  })

  t.same(minThingy.min, thingy)
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

  const errThatCausesBackoff:any = new Error('yay')
  errThatCausesBackoff.code = 'ResourceNotFoundException'

  const errThatCausesExit:any = new Error('nay')
  errThatCausesExit.code = 'ResourceIsStupidException'

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

test('db hooks', loudAsync(async (t) => {
  const db = createDB()
  const item = {
    a: 1,
    b: 2
  }

  db.hook('put:pre', ({ args: [resource, opts] }) => {
    t.same(resource, item)
    throw new Error('boo')
  })

  try {
    await db.put(item)
    t.fail('expected error')
  } catch (err) {
    t.equal(err.message, 'boo')
  }

  t.end()
}))

let only
;[
  defaultIndexes,
  defaultIndexes.map(toProjectionTypeAll)
].forEach(indexes => {
  const { ProjectionType } = indexes[0].projection
  const testNamed:any = (name, fn) => {
    return test(`${name} (ProjectionType: ${ProjectionType})`, fn)
  }

  testNamed.skip = test.skip
  testNamed.only = (...args) => {
    if (only) return
    only = true
    return test.only(...args)
  }

  testNamed('put/update', loudAsync(async (t) => {
    await reload(indexes)
    const photoId = photoIds[0]
    await db.put(photoId)
    const keys = {
      [TYPE]: photoId[TYPE],
      _link: photoId._link,
      _permalink: photoId._permalink
    }

    const saved = await db.get(keys)
    t.same(saved, photoId)

    const update = { ...keys, _displayName: 'blah' }
    const expected = { ...photoId, ...update }
    await db.update(update)
    const updated = await db.get({
      [TYPE]: photoId[TYPE],
      _permalink: photoId._permalink
    })

    t.same(updated, expected)
    t.end()
  }))

  testNamed('basic pagination', loudAsync(async (t) => {
    await reload(indexes)
    const filter = {
      EQ: {
        [TYPE]: FORM_REQUEST
      }
    }

    const orderBy = {
      property: '_time',
      desc: false
    }

    const expected = formRequests.slice()
    sortResults({ results: expected, orderBy })

    const page1 = await db.find({
      filter,
      orderBy,
      limit: 5
    })

    t.same(page1.items, expected.slice(0, 5))

    // search in reverse
    const page1Again = await db.find({
      filter,
      orderBy: {
        ...orderBy,
        desc: !orderBy.desc
      },
      checkpoint: page1.endPosition,
      limit: 4
    })

    const reverseFirstPage = expected.slice(0, 4).reverse()
    t.same(page1Again.items, reverseFirstPage, '"before" works')
    t.same(page1Again.startPosition, getItemPosition({
      db,
      filter: expandFilter(db.tables[FORM_REQUEST], filter),
      orderBy,
      item: reverseFirstPage[0]
    }))

    t.same(page1Again.endPosition, page1.startPosition)

    const page2 = await db.find({
      filter,
      orderBy,
      checkpoint: page1.endPosition,
      limit: 5
    })

    t.same(page2.items, expected.slice(5, 10))
    const page3 = await db.find({
      filter,
      orderBy,
      checkpoint: page2.endPosition
    })

    t.same(page3.items, expected.slice(10))
    t.end()
  }))

  testNamed('orderBy', loudAsync(async (t) => {
    await reload(indexes)
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
      checkpoint: page1.endPosition,
      orderBy,
      limit: 5
    })

    // console.log(page2.items.map(i => i.form), expected.slice(5, 10).map(i => i.form))
    t.same(page2.items, expected.slice(5, 10))
    const page3 = await db.find({
      filter,
      checkpoint: page2.endPosition,
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

  testNamed('indexed props (_author)', loudAsync(async (t) => {
    await reload(indexes)
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
      checkpoint: page1.endPosition,
      filter,
      orderBy,
      limit: 5
    })

    t.same(page2.items, expected.slice(5, 10))
    const page3 = await db.find({
      checkpoint: page2.endPosition,
      filter,
      orderBy
    })

    t.same(page3.items, expected.slice(10, 20))
    t.end()
  }))

  testNamed('indexed props (_t)', loudAsync(async (t) => {
    await reload(indexes)
    await db.batchPut(formRequests)
    await db.batchPut(photoIds)

    await Promise.all([photoIds, formRequests].map(async (dataset) => {
      const type = dataset[0][TYPE]
      const expected = dataset.slice()

      // make sure we have something to query!
      t.ok(expected.length >= 20)

      const orderBy = {
        property: '_time'
      }

      const filter = {
        EQ: {
          [TYPE]: type
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
        checkpoint: page1.endPosition,
        filter,
        orderBy,
        limit: 5
      })

      t.same(page2.items, expected.slice(5, 10))
      const page3 = await db.find({
        checkpoint: page2.endPosition,
        filter,
        orderBy
      })

      t.same(page3.items, expected.slice(10, 20))
    }))

    t.end()
  }))

  testNamed('latest', loudAsync(async (t) => {
    await reload(indexes)
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

  testNamed('db', loudAsync(async (t) => {
    await reload(indexes)
    const req = formRequests[0]
    const type = req[TYPE]
    const link = req._link
    const permalink = req._permalink
    t.same(await db.get({
      [TYPE]: type,
      _permalink: permalink
    }), req, 'db.get')

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

    // try {
    //   await db.latest({
    //     [TYPE]: type,
    //     _permalink: permalink
    //   })

    //   t.fail('expected NotFound error')
    // } catch (err) {
    //   t.equal(err.name, 'NotFound')
    // }

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

  testNamed('filters', loudAsync(async (t) => {
    await reload(indexes)
    const type = 'tradle.PhotoID'
    const photoIds = resources.filter(item => item[TYPE] === type)
    // const byType = groupByType(resources)
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

      const badCountries = photoIds.slice(0, 2).map(photoId => photoId.country.id)
      expected = photoIds.slice(2).filter(photoId => {
        return !badCountries.includes(photoId.country.id)
      })

      if (!expected.length) throw new Error('bad test, need more fixtures')

      sortResults({ results: expected, orderBy })

      const photoIdsCountryNotIn = await db.find({
        orderBy,
        filter: {
          EQ: {
            [TYPE]: type
          },
          NOT_IN: {
            'country.id': badCountries
          }
        }
      })

      t.same(photoIdsCountryNotIn.items, expected, 'country not in..')

      let select = ['documentType', 'country']
      expected = photoIds.slice()
      sortResults({ results: expected, orderBy })
      expected = expected.map(photoId => _.pick(photoId, select))

      const photoIdsSelect = await db.find({
        select,
        orderBy,
        filter: {
          EQ: {
            [TYPE]: type
          }
        }
      })

      t.same(photoIdsSelect.items, expected, 'select subset of attributes')
    })

    for (const test of tests) {
      await test()
    }

    t.end()
  }))

  testNamed('custom primary keys', loudAsync(async (t) => {
    await reload(indexes)
    const ALIEN_CLASSIFIER = 'mynamespace.Alien' + Date.now()
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

    db.modelStore.addModel(alienModel)
    db.setExclusive({
      table: createTable({
        objects,
        docClient,
        // ...getCommonTableOpts(DB.getSafeTableName(alienModel.id)),
        model: alienModel,
        models: db.models,
        tableDefinition: getTableDefinitionForModel({
          models: db.models,
          model: alienModel
        }),
        getIndexesForModel: model => [],
        exclusive: true
      })
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

    await db.tables[ALIEN_CLASSIFIER].put(alien)
    t.same(await db.get({
      [TYPE]: ALIEN_CLASSIFIER,
      color: alien.color,
      fingerCount: alien.fingerCount
    }), alien)

    const searchResult = await db.find({
      orderBy: {
        property: 'fingerCount'
      },
      filter: {
        EQ: {
          [TYPE]: ALIEN_CLASSIFIER,
          color: alien.color
        },
        GT: {
          fingerCount: alien.fingerCount - 1
        }
      }
    })

    t.same(searchResult.items, [alien])
    t.end()
  }))

  testNamed('cleanup', async (t) => {
    await cleanup(indexes)
    t.end()
  })
})

test('multiple types, overloaded indexes', loudAsync(async t => {
  const eventModel = {
    type: 'tradle.Model',
    id: 'tradle.Event',
    title: 'Event',
    properties: {
      topic: {
        type: 'string'
      },
      time: {
        type: 'string'
      },
      payload: {
        type: 'object',
        range: 'json'
      }
    },
    primaryKeys: {
      hashKey: 'topic',
      rangeKey: 'time' // constant
    },
    indexes: [
      {
        hashKey: {
          template: '{payload.user}'
        },
        rangeKey: {
          template: '{time}'
        }
      }
    ]
  }

  const myModels = {
    ...models,
    [eventModel.id]: eventModel
  }

  const getIndexesForModel = ({ model, table }) => {
    if (model.id === eventModel.id) {
      return eventModel.indexes.map(normalizeIndexedPropertyTemplateSchema)
    }

    return defaults.indexes.concat(model.indexes || []).map(normalizeIndexedPropertyTemplateSchema)
  }

  const table = new Table({
    docClient,
    models: myModels,
    modelsStored: myModels,
    // objects,
    allowScan: false,
    tableDefinition: def,
    derivedProps: tableKeys,
    deriveProps: defaults.deriveProps,
    getIndexesForModel
  })

  const event = {
    [TYPE]: 'tradle.Event',
    topic: 'user:online',
    time: new Date('2000-01-01').getTime(),
    payload: {
      user: 'bob',
    }
  }

  const contactInfo = {
    [TYPE]: 'tradle.BasicContactInfo',
    [SIG]: 'abc',
    firstName: 'bob',
    lastName: 'gleggknook',
    email: 'bobg@knook.com',
    _author: 'bobhash',
    _link: 'aaa',
    _permalink: 'aaa',
    _time: new Date('2000-01-01').getTime()
  }

  const items = [event, contactInfo]
  await table.create()
  await Promise.all(items.map(item => table.put(item)))

  const foundContactInfo = await table.findOne({
    orderBy: {
      property: '_time',
      desc: false
    },
    filter: {
      EQ: {
        [TYPE]: contactInfo[TYPE],
        _author: contactInfo._author
      }
    }
  })

  t.same(foundContactInfo, contactInfo)

  const foundEvent = await table.findOne({
    filter: {
      EQ: {
        [TYPE]: event[TYPE],
        topic: event.topic
      }
    }
  })

  t.same(foundEvent, event)

  // const results = await new Promise((resolve, reject) => {
  //   table.table.scan().exec((err, results) => {
  //     if (err) return reject(err)

  //     resolve(results.Items.map(item => item.toJSON()))
  //   })
  // })

  // console.log('table', def.tableName, JSON.stringify(results, null, 2))

  await Promise.all(def.indexes.map(async (index, i) => {
    const indexed = await docClient.scan({
      TableName: def.tableName,
      IndexName: index.name
    }).promise()

    const expectedCount = items.map(item => {
      const model = myModels[item[TYPE]]
      const indexes = getIndexesForModel({ table, model })
      return indexes[i] ? 1 : 0
    })
    .reduce((sum, num) => sum + num, 0)

    t.equal(indexed.Items.length, expectedCount)
    // console.log('index', index.name, JSON.stringify(indexed, null, 2))
  }))

  await table.destroy()

  t.end()

  // const db = new DB({
  //   modelStore: createModelStore({ models }),
  //   tableNames,
  //   // tableNames: lastCreated,
  //   defineTable: name => {
  //     const opts = getCommonTableOpts(DB.getSafeTableName(name), indexes)
  //     const table = new Table({
  //       ...opts,
  //       models,
  //       objects,
  //       docClient
  //     })

  //     table.hook('put:pre', createControlLatestHook(table, 'put'))
  //     table.hook('update:pre', createControlLatestHook(table, 'update'))
  //     return table
  //   }
  // })
}))

// test.only('index derived props', loudAsync(async t => {
//   // const index = {
//   //   hashKey: '__index__0',
//   //   rangeKey: 'time',
//   //   name: 'overloadedindex1',
//   //   type: 'global',
//   //   projection: {
//   //     ProjectionType: 'ALL'
//   //   }
//   // }

//   // try {
//   //   await cleanup(defaultIndexes)
//   // } catch (err) {}

//   // try {
//   //   await cleanup(defaultIndexes.map(toProjectionTypeAll))
//   // } catch (err) {}

//   // const db = new DB({
//   //   modelStore: createModelStore({ models }),
//   //   tableNames: lastCreated,
//   //   defineTable: name => new Table(getCommonTableOpts(DB.getSafeTableName(name), indexes))
//   // })
// }))

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

function byLinkAsc (a, b) {
  return a._link < b._link ? -1 : a._link > b._link ? 1 : 0
}

function toProjectionTypeAll (index) {
  return {
    ...index,
    projection: {
      ProjectionType: 'ALL'
    }
  }
}

function getItemPosition ({ db, filter, orderBy, item }) {
  return getQueryInfo({
    type: filter.EQ[TYPE],
    table: db.tables[filter.EQ[TYPE]],
    filter,
    orderBy
  }).itemToPosition(item)
}

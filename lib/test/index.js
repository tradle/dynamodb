"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
require('source-map-support').install();
const crypto = require("crypto");
const test = require("tape");
const dynogels = require("dynogels");
const constants_1 = require("@tradle/constants");
const buildResource = require("@tradle/build-resource");
const mergeModels = require("@tradle/merge-models");
const models = mergeModels()
    .add(require('@tradle/models').models)
    .add(require('@tradle/custom-models'))
    .get();
const minify_1 = require("../minify");
const { defaultOrderBy, defaultIndexes } = require('../constants');
const { debug, sortResults, wait, runWithBackoffOnTableNotExists } = require('../utils');
// dynogels.log = {
//   info: debug,
//   warn: debug,
//   level: 'info'
// }
const fixtures = require('./fixtures');
const FORM_REQUEST = 'tradle.FormRequest';
const formRequests = fixtures
    .filter(fixture => fixture[constants_1.TYPE] === FORM_REQUEST)
    .slice(0, 20);
const photoIds = fixtures
    .filter(fixture => fixture[constants_1.TYPE] === 'tradle.PhotoID')
    .slice(0, 20);
sortResults({ results: formRequests, orderBy: defaultOrderBy });
const endpoint = 'http://localhost:4569';
const { AWS } = dynogels;
AWS.config.update({
    // localstack
    endpoint,
    region: 'us-east-1',
    accessKeyId: 'YOURKEY',
    secretAccessKey: 'YOURSECRET',
});
const docClient = new AWS.DynamoDB.DocumentClient({ endpoint });
const objects = (function () {
    const cache = {};
    const api = {
        get: (link) => __awaiter(this, void 0, void 0, function* () {
            const match = cache[link];
            if (match)
                return match;
            throw new Error('NotFound');
        }),
        put: item => {
            cache[item._link] = item;
        }
    };
    fixtures.forEach(api.put);
    return api;
}());
const _1 = require("../");
let db;
let table;
let offset = Date.now();
let lastCreated = [];
const cleanup = () => __awaiter(this, void 0, void 0, function* () {
    if (!lastCreated.length)
        return;
    db = new _1.DB({
        tableNames: lastCreated,
        tableOpts: {
            objects,
            models,
            maxItemSize: 4000,
            docClient,
            validate: false,
        }
    });
    yield db.destroyTables();
});
const reload = () => __awaiter(this, void 0, void 0, function* () {
    yield cleanup();
    const prefix = '' + (offset++);
    lastCreated = ['a', 'b', 'c', 'd', 'e'].map(name => prefix + name);
    db = new _1.DB({
        tableNames: lastCreated,
        tableOpts: {
            objects,
            models,
            maxItemSize: 4000,
            docClient,
            validate: false,
        }
    });
    yield db.createTables();
    yield db.batchPut(formRequests);
    // table = db.tables[FORM_REQUEST]
    // await db.batchPut(formRequests)
});
test('minify (big values)', function (t) {
    const bigMsg = {
        [constants_1.TYPE]: 'tradle.SimpleMessage',
        message: 'blah'.repeat(1000)
    };
    // fake table
    const table = {
        models,
        indexes: defaultIndexes
    };
    const minBigMsg = minify_1.default({
        table,
        item: bigMsg,
        maxSize: 1000
    });
    t.same(minBigMsg.diff, { message: bigMsg.message });
    t.same(minBigMsg.min, {
        [constants_1.TYPE]: bigMsg[constants_1.TYPE],
        _cut: ['message']
    });
    const smallMsg = {
        [constants_1.TYPE]: 'tradle.SimpleMessage',
        message: 'blah'.repeat(100)
    };
    const minSmallMsg = minify_1.default({
        item: smallMsg,
        table,
        maxSize: 1000
    });
    t.same(minSmallMsg.diff, {});
    t.same(minSmallMsg.min, smallMsg);
    t.end();
});
test('minify (embedded media)', function (t) {
    const photoId = {
        [constants_1.TYPE]: 'tradle.PhotoID',
        scan: {
            url: 'data:image/jpeg;base64,' + 'blah'.repeat(1000)
        }
    };
    // fake table
    const table = {
        models,
        indexes: defaultIndexes
    };
    const minPhotoId = minify_1.default({
        item: photoId,
        table,
        maxSize: 1000
    });
    t.same(minPhotoId.min._cut, ['scan']);
    t.end();
});
test('minify (optional props)', function (t) {
    // optional
    const thingy = {
        [constants_1.TYPE]: 'tradle.Thingy',
        a: 'a'.repeat(99),
        b: 'b'.repeat(99)
    };
    const customModels = Object.assign({}, models, { [thingy[constants_1.TYPE]]: {
            properties: {
                a: { type: 'string' },
                b: { type: 'string' }
            },
            required: [
                'a'
            ]
        } });
    // fake table
    const table = {
        models: customModels,
        indexes: defaultIndexes
    };
    const minThingy = minify_1.default({
        item: thingy,
        table,
        maxSize: 200
    });
    t.same(minThingy.min._cut, ['b']);
    t.end();
});
test('sortResults', function (t) {
    const asc = sortResults({
        results: formRequests.slice(),
        orderBy: { property: 'form' }
    });
    t.ok(asc.every((item, i) => {
        return i === 0 || item.form >= asc[i - 1].form;
    }), 'sort asc');
    const desc = sortResults({
        results: formRequests.slice(),
        orderBy: { property: 'form', desc: true }
    });
    t.ok(desc.every((item, i) => {
        return i === 0 || item.form <= desc[i - 1].form;
    }), 'sort desc');
    // nested
    const ascById = sortResults({
        results: photoIds.slice(),
        orderBy: { property: 'documentType.id' }
    });
    t.ok(ascById.every((item, i) => {
        return i === 0 ||
            item.documentType.id >= ascById[i - 1].documentType.id;
    }), 'sort by nested prop');
    // fallback to default
    const fallback = sortResults({
        results: photoIds.slice()
    });
    const expectedFallback = sortResults({
        results: photoIds.slice(),
        orderBy: defaultOrderBy
    });
    t.same(fallback, expectedFallback, 'fall back to default sorting order');
    t.end();
});
test('backoff after create', loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    const backoffOpts = {
        initialDelay: 50,
        maxDelay: 100,
        maxTime: 500
    };
    let expectedResult = 1;
    let failsLeft = 3;
    const errThatCausesBackoff = new Error('yay');
    errThatCausesBackoff.name = 'ResourceNotFoundException';
    const errThatCausesExit = new Error('nay');
    errThatCausesExit.name = 'ResourceIsStupidException';
    let result = yield runWithBackoffOnTableNotExists(() => __awaiter(this, void 0, void 0, function* () {
        if (failsLeft-- > 0) {
            throw errThatCausesBackoff;
        }
        return expectedResult;
    }), backoffOpts);
    t.equal(result, expectedResult);
    try {
        result = yield runWithBackoffOnTableNotExists(() => __awaiter(this, void 0, void 0, function* () {
            throw errThatCausesExit;
        }), backoffOpts);
        t.fail('expected error');
    }
    catch (err) {
        t.equal(err, errThatCausesExit);
    }
    const start = Date.now();
    try {
        result = yield runWithBackoffOnTableNotExists(() => __awaiter(this, void 0, void 0, function* () {
            throw errThatCausesBackoff;
        }), backoffOpts);
        t.fail('expected operation to time out');
    }
    catch (err) {
        t.equal(err.message, 'timed out');
        const time = Date.now() - start;
        // expected delta should be around a tick (15-20ms)
        // but let's give it some room
        const delta = Math.abs(time - backoffOpts.maxTime);
        t.ok(delta < 100);
    }
    t.end();
})));
test('basic pagination', loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    yield reload();
    const filter = {
        EQ: {
            [constants_1.TYPE]: FORM_REQUEST
        }
    };
    const page1 = yield db.find({
        filter,
        limit: 5
    });
    t.same(page1.items, formRequests.slice(0, 5));
    const page2 = yield db.find({
        filter,
        after: page1.endPosition,
        limit: 5
    });
    t.same(page2.items, formRequests.slice(5, 10));
    const page3 = yield db.find({
        filter,
        after: page2.endPosition
    });
    t.same(page3.items, formRequests.slice(10));
    t.end();
})));
test('orderBy', loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    yield reload();
    const filter = {
        EQ: {
            [constants_1.TYPE]: FORM_REQUEST
        }
    };
    const expected = formRequests.slice();
    const orderBy = {
        property: 'form'
    };
    sortResults({ results: expected, orderBy });
    const page1 = yield db.find({
        filter,
        orderBy,
        limit: 5
    });
    t.same(page1.items, expected.slice(0, 5));
    const page2 = yield db.find({
        filter,
        after: page1.endPosition,
        orderBy,
        limit: 5
    });
    t.same(page2.items, expected.slice(5, 10));
    const page3 = yield db.find({
        filter,
        after: page2.endPosition,
        orderBy
    });
    t.same(page3.items, expected.slice(10));
    // and in reverse
    expected.reverse();
    orderBy.desc = true;
    sortResults({ results: expected, orderBy });
    const desc1 = yield db.find({
        filter,
        orderBy,
        limit: 5
    });
    t.same(desc1.items, expected.slice(0, 5));
    t.end();
})));
test('indexed props', loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    yield reload();
    const _author = formRequests[0]._author;
    const expected = formRequests.slice()
        .filter(fr => fr._author === _author);
    t.ok(expected.length >= 20);
    const orderBy = {
        property: '_time'
    };
    const filter = {
        EQ: {
            [constants_1.TYPE]: FORM_REQUEST,
            _author
        }
    };
    sortResults({ results: expected, orderBy });
    const page1 = yield db.find({
        orderBy,
        filter,
        limit: 5
    });
    t.same(page1.items, expected.slice(0, 5));
    const page2 = yield db.find({
        after: page1.endPosition,
        filter,
        orderBy,
        limit: 5
    });
    t.same(page2.items, expected.slice(5, 10));
    const page3 = yield db.find({
        after: page2.endPosition,
        filter,
        orderBy,
    });
    t.same(page3.items, expected.slice(10, 20));
    t.end();
})));
test('latest', loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    yield reload();
    const v1 = formRequests[0];
    yield db.put(v1);
    const v2 = Object.assign({}, v1);
    v2[constants_1.SIG] = crypto.randomBytes(128).toString('base64');
    v2[constants_1.PERMALINK] = v2._permalink;
    v2[constants_1.PREVLINK] = v2._link;
    buildResource.setVirtual(v2, {
        _time: v1._time - 1,
        _link: crypto.randomBytes(32).toString('hex')
    });
    try {
        yield db.put(v2);
        t.fail('conditional check should have failed');
    }
    catch (err) {
        t.equals(err.name, 'ConditionalCheckFailedException');
    }
    buildResource.setVirtual(v2, {
        _time: v1._time + 1,
        _link: crypto.randomBytes(32).toString('hex')
    });
    yield db.put(v2);
    t.same(yield db.get({
        [constants_1.TYPE]: FORM_REQUEST,
        _permalink: v2._permalink
    }), v2);
    t.end();
})));
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
test('db', loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    yield reload();
    const req = formRequests[0];
    const type = req[constants_1.TYPE];
    const link = req._link;
    const permalink = req._permalink;
    t.same(yield db.get({
        [constants_1.TYPE]: type,
        _permalink: permalink
    }), req, 'db.get');
    t.same(yield db.latest({
        [constants_1.TYPE]: type,
        _permalink: permalink
    }), req, 'db.latest');
    yield db.del({
        [constants_1.TYPE]: type,
        _permalink: permalink
    });
    try {
        yield db.get({
            [constants_1.TYPE]: type,
            _permalink: permalink
        });
        t.fail('expected NotFound error');
    }
    catch (err) {
        t.equal(err.name, 'NotFound');
    }
    try {
        yield db.latest({
            [constants_1.TYPE]: type,
            _permalink: permalink
        });
        t.fail('expected NotFound error');
    }
    catch (err) {
        t.equal(err.name, 'NotFound');
    }
    yield db.put(req);
    t.same(yield db.get({
        [constants_1.TYPE]: type,
        _permalink: permalink
    }), req);
    const searchResult = yield db.find({
        filter: {
            EQ: {
                [constants_1.TYPE]: type,
                form: req.form
            }
        }
    });
    const expectedSearchResult = formRequests.filter(({ form }) => form === req.form);
    t.same(searchResult.items, expectedSearchResult);
    t.end();
})));
test('filters', loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    yield reload();
    const type = 'tradle.PhotoID';
    const photoIds = fixtures.filter(item => item[constants_1.TYPE] === type);
    // const byType = groupByType(fixtures)
    // photoIds.forEach(objects.put)
    yield db.batchPut(photoIds);
    // await Object.keys(byType).map(type => {
    //   if (db.tables[type]) {
    //     return db.batchPut(byType[type])
    //   }
    //   return Promise.resolve()
    // })
    const orderBy = {
        property: '_time'
    };
    const orderByCombinations = getOrderByCombinations({
        properties: ['_time', '_author', '_link']
    });
    const tests = orderByCombinations.map(orderBy => () => __awaiter(this, void 0, void 0, function* () {
        const first = photoIds[0];
        let expected;
        const startsWithStr = 'tradle.';
        expected = photoIds.filter(photoId => {
            return photoId.country.id.startsWith(startsWithStr);
        });
        sortResults({ results: expected, orderBy });
        const countryIdStartsWith = yield db.find({
            orderBy,
            filter: {
                EQ: {
                    [constants_1.TYPE]: type
                },
                STARTS_WITH: {
                    'country.id': startsWithStr
                }
            }
        });
        t.same(countryIdStartsWith.items, expected, 'country.id STARTS_WITH');
        const minTime = photoIds[0]._time;
        expected = photoIds.filter(photoId => {
            return photoId._time > minTime;
        });
        sortResults({ results: expected, orderBy });
        const photoIdsGt = yield db.find({
            orderBy,
            filter: {
                EQ: {
                    [constants_1.TYPE]: type
                },
                GT: {
                    _time: minTime
                }
            }
        });
        t.same(photoIdsGt.items, expected, '_time GT');
        const countries = ['tradle.Country_efe0530781364d08e8ab58e34fe8fffc2db3af39449242a95c0a3307826475da_efe0530781364d08e8ab58e34fe8fffc2db3af39449242a95c0a3307826475da'];
        expected = photoIds.filter(photoId => {
            return countries.includes(photoId.country.id);
        });
        sortResults({ results: expected, orderBy });
        const photoIdsIn = yield db.find({
            orderBy,
            filter: {
                EQ: {
                    [constants_1.TYPE]: type
                },
                IN: {
                    'country.id': countries
                }
            }
        });
        t.same(photoIdsIn.items, expected, 'countries IN');
        expected = [];
        sortResults({ results: expected, orderBy });
        const photoIdsCountryNull = yield db.find({
            orderBy,
            filter: {
                EQ: {
                    [constants_1.TYPE]: type
                },
                NULL: {
                    country: true
                }
            }
        });
        t.same(photoIdsCountryNull.items, expected, 'country null');
        expected = photoIds.slice();
        sortResults({ results: expected, orderBy });
        const photoIdsCountryNotNull = yield db.find({
            orderBy,
            filter: {
                EQ: {
                    [constants_1.TYPE]: type
                },
                NULL: {
                    country: false
                }
            }
        });
        t.same(photoIdsCountryNotNull.items, expected, 'country not null');
    }));
    for (const test of tests) {
        yield test();
    }
    t.end();
})));
test('addModels', loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    yield reload();
    const A_TYPE = 'mynamespace.modelA';
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
    });
    t.ok(db.tables[A_TYPE], 'models added dynamically');
    t.ok(db.tables[A_TYPE].opts.models, 'latest models propagated in options to table');
    const a = {
        _link: 'alink',
        _permalink: 'alink',
        _time: 1505941645561,
        [constants_1.TYPE]: A_TYPE,
        a: 'a'
    };
    yield db.put(a);
    t.same(yield db.get({
        [constants_1.TYPE]: A_TYPE,
        _permalink: a._link
    }), a);
    t.end();
})));
test('custom primary keys', loudAsync((t) => __awaiter(this, void 0, void 0, function* () {
    yield reload();
    const ALIEN_CLASSIFIER = 'mynamespace.Alien';
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
    };
    db.addModels({
        [ALIEN_CLASSIFIER]: alienModel
    });
    db.setExclusive({
        model: alienModel
    });
    yield db.tables[ALIEN_CLASSIFIER].create();
    const updatedModels = db.models;
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
        .toJSON();
    yield db.put(alien);
    t.same(yield db.get(alien), alien);
    const searchResult = yield db.find({
        orderBy: {
            property: 'fingerCount'
        },
        filter: {
            EQ: {
                [constants_1.TYPE]: ALIEN_CLASSIFIER,
                color: '#0000ff'
            },
            GT: {
                fingerCount: 10
            }
        }
    });
    t.same(searchResult.items, [alien]);
    t.end();
})));
test('cleanup', (t) => __awaiter(this, void 0, void 0, function* () {
    yield cleanup();
    t.end();
}));
function loudAsync(asyncFn) {
    return (...args) => __awaiter(this, void 0, void 0, function* () {
        try {
            return yield asyncFn(...args);
        }
        catch (err) {
            console.error(err);
            throw err;
        }
    });
}
function prettify(obj) {
    return JSON.stringify(obj, null, 2);
}
function groupByType(items) {
    const byType = {};
    for (const item of items) {
        const type = item[constants_1.TYPE];
        if (!byType[type]) {
            byType[type] = [];
        }
        byType[type].push(item);
    }
    return byType;
}
function getOrderByCombinations({ properties }) {
    return properties.map(property => ([
        {
            property
        },
        {
            property,
            desc: true
        }
    ]))
        .reduce((arr, batch) => arr.concat(batch), []);
}
function byLink(a, b) {
    return a._link < b._link ? -1 : a._link > b._link ? 1 : 0;
}
//# sourceMappingURL=index.js.map
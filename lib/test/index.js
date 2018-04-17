"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
require('source-map-support').install();
const crypto_1 = tslib_1.__importDefault(require("crypto"));
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const tape_1 = tslib_1.__importDefault(require("tape"));
const dynogels_1 = tslib_1.__importDefault(require("dynogels"));
const constants_1 = require("@tradle/constants");
const validate_resource_1 = tslib_1.__importDefault(require("@tradle/validate-resource"));
const build_resource_1 = tslib_1.__importDefault(require("@tradle/build-resource"));
const merge_models_1 = tslib_1.__importDefault(require("@tradle/merge-models"));
const models = merge_models_1.default()
    .add(require('@tradle/models').models)
    .add(require('@tradle/custom-models'))
    .get();
const minify_1 = tslib_1.__importDefault(require("../minify"));
const defaults = tslib_1.__importStar(require("../defaults"));
const filter_dynamodb_1 = require("../filter-dynamodb");
const constants_2 = require("../constants");
const utils_1 = require("../utils");
const utils_2 = require("./utils");
const sortResults = opts => utils_1.sortResults(Object.assign({ defaultOrderBy: constants_2.defaultOrderBy }, opts));
dynogels_1.default.log = {
    info: utils_1.debug,
    warn: utils_1.debug,
    level: 'info'
};
const resources = require('./fixtures/resources.json');
const tableSchema = require('./fixtures/table-schema.json');
const def = utils_1.toDynogelTableDefinition(Object.assign({}, tableSchema, { TableName: 'test-resources-' + Date.now() }));
const { hashKey, rangeKey } = def;
const tableKeys = [hashKey, rangeKey]
    .concat(lodash_1.default.flatten(def.indexes.map(def => [def.hashKey, def.rangeKey])))
    .filter(lodash_1.default.identity);
const FORM_REQUEST = 'tradle.FormRequest';
const FORM_REQUEST_MODEL = models[FORM_REQUEST];
const formRequests = resources
    .filter(r => r[constants_1.TYPE] === FORM_REQUEST)
    .slice(0, 20);
const photoIds = resources
    .filter(r => r[constants_1.TYPE] === 'tradle.PhotoID')
    .slice(0, 20);
sortResults({ results: formRequests, orderBy: constants_2.defaultOrderBy });
const endpoint = 'http://localhost:4569';
const { AWS } = dynogels_1.default;
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
        get: (link) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            const match = cache[link];
            if (match)
                return match;
            throw new Error('NotFound');
        }),
        put: item => {
            cache[item._link] = item;
        }
    };
    resources.forEach(api.put);
    return api;
}());
const _1 = require("../");
let db;
let table;
let offset = Date.now();
let lastCreated = [];
const createDB = (indexes) => {
    return utils_2.createDB({
        tableNames: lastCreated,
        docClient,
        objects,
        models,
        indexes
    });
};
const cleanup = (indexes) => tslib_1.__awaiter(this, void 0, void 0, function* () {
    if (!lastCreated.length)
        return;
    db = createDB(indexes);
    yield db.destroyTables();
});
const validResources = resources.filter(resource => {
    try {
        validate_resource_1.default({ models, resource });
        return true;
    }
    catch (err) { }
});
const numTables = 1;
const reload = (indexes) => tslib_1.__awaiter(this, void 0, void 0, function* () {
    yield cleanup(indexes);
    const prefix = '' + (offset++);
    lastCreated = lodash_1.default.range(0, numTables).map(i => prefix + i);
    db = createDB(indexes);
    yield db.createTables();
    // await db.batchPut(validResources)
    yield db.batchPut(formRequests);
    // table = db.tables[FORM_REQUEST]
    // await db.batchPut(formRequests)
});
// test.only('load', loudAsync(async (t) => {
//   await reload()
//   t.end()
// }))
tape_1.default('key templates', t => {
    t.same([
        'a',
        ['a'],
        ['a', 'b'],
        '{a}{b}{c}',
        { hashKey: ['a', 'b'], rangeKey: '{a}{b}{c}' },
    ].map(utils_1.normalizeIndexedPropertyTemplateSchema), [
        { hashKey: { template: '{a}' } },
        { hashKey: { template: '{a}' } },
        { hashKey: { template: '{a}{b}' } },
        { hashKey: { template: '{a}{b}{c}' } },
        { hashKey: { template: '{a}{b}' }, rangeKey: { template: '{a}{b}{c}' } },
    ]);
    t.same(utils_1.getTemplateStringVariables('{a}lala{b}'), ['a', 'b']);
    const model = {
        type: 'tradle.Model',
        id: 'tradle.Namey',
        title: 'Namey name',
        properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            nickName: { type: 'string' },
        },
        required: ['firstName', 'lastName'],
        indexes: [
            {
                hashKey: '{firstName} "Angry" {lastName}',
                rangeKey: ['lastName', 'firstName'],
            }
        ]
    };
    const models = { [model.id]: model };
    const table = _1.createTable({
        objects,
        docClient,
        model,
        models,
        tableDefinition: tableSchema,
        derivedProps: tableKeys
    });
    table.storeResourcesForModel({ model });
    const derived = defaults.deriveProps({
        table,
        item: {
            [constants_1.TYPE]: model.id,
            firstName: 'Bill S',
            lastName: 'Preston'
        },
        isRead: false
    });
    t.same(derived, {
        __r__: '_',
        __x0h__: 'tradle.Namey{Bill%20S} "Angry" {Preston}',
        __x0r__: '{Preston}{Bill%20S}'
    });
    t.same(defaults.parseDerivedProps({
        table,
        model,
        resource: derived
    }), {
        [constants_1.TYPE]: model.id,
        firstName: 'Bill S',
        lastName: 'Preston'
    });
    t.end();
});
tape_1.default('model store', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
    let externalSource = models;
    let i = 0;
    const onMissingModel = (id) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        i++;
        store.addModels(lodash_1.default.pick(externalSource, ['tradle.Object', 'tradle.Seal']));
        return externalSource[id];
    });
    const store = _1.createModelStore({
        onMissingModel
    });
    t.same(yield store.get('tradle.Object'), externalSource['tradle.Object']);
    t.equal(i, 1);
    try {
        yield store.get('dsahjdksa');
        t.fail('expected not found');
    }
    catch (err) {
        t.ok(/not found/i.test(err.message));
    }
    t.end();
})));
tape_1.default('minify (big values)', function (t) {
    const bigMsg = {
        [constants_1.TYPE]: 'tradle.SimpleMessage',
        message: 'blah'.repeat(1000),
        shortMessage: 'blah'.repeat(10)
    };
    // fake table
    const table = {
        models,
        indexes: utils_2.defaultIndexes
    };
    const minBigMsg = minify_1.default({
        table,
        item: bigMsg,
        maxSize: 1000
    });
    t.same(minBigMsg.diff, { message: bigMsg.message });
    t.same(minBigMsg.min, {
        [constants_1.TYPE]: bigMsg[constants_1.TYPE],
        shortMessage: bigMsg.shortMessage,
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
tape_1.default('minify (retain resource values)', function (t) {
    const id = 'some.thingy.Thing';
    const customModels = Object.assign({}, models, { [id]: {
            id,
            properties: {
                friend: {
                    type: 'object',
                    ref: 'tradle.Identity'
                }
            }
        } });
    // fake table
    const table = {
        models: customModels,
        indexes: utils_2.defaultIndexes
    };
    const thingy = {
        [constants_1.TYPE]: id,
        friend: {
            id: `${id}_abc_123`
        }
    };
    const minThingy = minify_1.default({
        item: thingy,
        table,
        maxSize: 1
    });
    t.same(minThingy.min, thingy);
    t.end();
});
tape_1.default('minify (optional props)', function (t) {
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
        indexes: utils_2.defaultIndexes
    };
    const minThingy = minify_1.default({
        item: thingy,
        table,
        maxSize: 200
    });
    t.same(minThingy.min._cut, ['b']);
    t.end();
});
tape_1.default('sortResults', function (t) {
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
        orderBy: constants_2.defaultOrderBy
    });
    t.same(fallback, expectedFallback, 'fall back to default sorting order');
    t.end();
});
tape_1.default('backoff after create', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
    const backoffOpts = {
        initialDelay: 50,
        maxDelay: 100,
        maxTime: 500
    };
    let expectedResult = 1;
    let failsLeft = 3;
    const errThatCausesBackoff = new Error('yay');
    errThatCausesBackoff.code = 'ResourceNotFoundException';
    const errThatCausesExit = new Error('nay');
    errThatCausesExit.code = 'ResourceIsStupidException';
    let result = yield utils_1.runWithBackoffOnTableNotExists(() => tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (failsLeft-- > 0) {
            throw errThatCausesBackoff;
        }
        return expectedResult;
    }), backoffOpts);
    t.equal(result, expectedResult);
    try {
        result = yield utils_1.runWithBackoffOnTableNotExists(() => tslib_1.__awaiter(this, void 0, void 0, function* () {
            throw errThatCausesExit;
        }), backoffOpts);
        t.fail('expected error');
    }
    catch (err) {
        t.equal(err, errThatCausesExit);
    }
    const start = Date.now();
    try {
        result = yield utils_1.runWithBackoffOnTableNotExists(() => tslib_1.__awaiter(this, void 0, void 0, function* () {
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
tape_1.default('db hooks', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
    const db = createDB();
    const item = {
        a: 1,
        b: 2
    };
    db.hook('put:pre', ({ args: [resource, opts] }) => {
        t.same(resource, item);
        throw new Error('boo');
    });
    try {
        yield db.put(item);
        t.fail('expected error');
    }
    catch (err) {
        t.equal(err.message, 'boo');
    }
    t.end();
})));
let only;
[
    utils_2.defaultIndexes,
    utils_2.defaultIndexes.map(toProjectionTypeAll)
].forEach(indexes => {
    const { ProjectionType } = indexes[0].projection;
    const testNamed = (name, fn) => {
        return tape_1.default(`${name} (ProjectionType: ${ProjectionType})`, fn);
    };
    testNamed.skip = tape_1.default.skip;
    testNamed.only = (...args) => {
        if (only)
            return;
        only = true;
        return tape_1.default.only(...args);
    };
    testNamed('put/update', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield reload(indexes);
        const photoId = photoIds[0];
        yield db.put(photoId);
        const keys = {
            [constants_1.TYPE]: photoId[constants_1.TYPE],
            _link: photoId._link,
            _permalink: photoId._permalink
        };
        const saved = yield db.get(keys);
        t.same(saved, photoId);
        const update = Object.assign({}, keys, { _displayName: 'blah' });
        const expected = Object.assign({}, photoId, update);
        yield db.update(update);
        const updated = yield db.get({
            [constants_1.TYPE]: photoId[constants_1.TYPE],
            _permalink: photoId._permalink
        });
        t.same(updated, expected);
        t.end();
    })));
    testNamed('basic pagination', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield reload(indexes);
        const filter = {
            EQ: {
                [constants_1.TYPE]: FORM_REQUEST
            }
        };
        const orderBy = {
            property: '_time',
            desc: false
        };
        const expected = formRequests.slice();
        sortResults({ results: expected, orderBy });
        const page1 = yield db.find({
            filter,
            orderBy,
            limit: 5
        });
        t.same(page1.items, expected.slice(0, 5));
        // search in reverse
        const page1Again = yield db.find({
            filter,
            orderBy: Object.assign({}, orderBy, { desc: !orderBy.desc }),
            checkpoint: page1.endPosition,
            limit: 4
        });
        const reverseFirstPage = expected.slice(0, 4).reverse();
        t.same(page1Again.items, reverseFirstPage, '"before" works');
        t.same(page1Again.startPosition, getItemPosition({
            db,
            filter: filter_dynamodb_1.expandFilter(db.tables[FORM_REQUEST], filter),
            orderBy,
            item: reverseFirstPage[0]
        }));
        t.same(page1Again.endPosition, page1.startPosition);
        const page2 = yield db.find({
            filter,
            orderBy,
            checkpoint: page1.endPosition,
            limit: 5
        });
        t.same(page2.items, expected.slice(5, 10));
        const page3 = yield db.find({
            filter,
            orderBy,
            checkpoint: page2.endPosition
        });
        t.same(page3.items, expected.slice(10));
        t.end();
    })));
    testNamed('orderBy', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield reload(indexes);
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
            checkpoint: page1.endPosition,
            orderBy,
            limit: 5
        });
        // console.log(page2.items.map(i => i.form), expected.slice(5, 10).map(i => i.form))
        t.same(page2.items, expected.slice(5, 10));
        const page3 = yield db.find({
            filter,
            checkpoint: page2.endPosition,
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
    testNamed('indexed props (_author)', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield reload(indexes);
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
            checkpoint: page1.endPosition,
            filter,
            orderBy,
            limit: 5
        });
        t.same(page2.items, expected.slice(5, 10));
        const page3 = yield db.find({
            checkpoint: page2.endPosition,
            filter,
            orderBy
        });
        t.same(page3.items, expected.slice(10, 20));
        t.end();
    })));
    testNamed('indexed props (_t)', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield reload(indexes);
        yield db.batchPut(formRequests);
        yield db.batchPut(photoIds);
        yield Promise.all([photoIds, formRequests].map((dataset) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            const type = dataset[0][constants_1.TYPE];
            const expected = dataset.slice();
            // make sure we have something to query!
            t.ok(expected.length >= 20);
            const orderBy = {
                property: '_time'
            };
            const filter = {
                EQ: {
                    [constants_1.TYPE]: type
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
                checkpoint: page1.endPosition,
                filter,
                orderBy,
                limit: 5
            });
            t.same(page2.items, expected.slice(5, 10));
            const page3 = yield db.find({
                checkpoint: page2.endPosition,
                filter,
                orderBy
            });
            t.same(page3.items, expected.slice(10, 20));
        })));
        t.end();
    })));
    testNamed('latest', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield reload(indexes);
        const v1 = formRequests[0];
        yield db.put(v1);
        const v2 = Object.assign({}, v1);
        v2[constants_1.SIG] = crypto_1.default.randomBytes(128).toString('base64');
        v2[constants_1.PERMALINK] = v2._permalink;
        v2[constants_1.PREVLINK] = v2._link;
        build_resource_1.default.setVirtual(v2, {
            _time: v1._time - 1,
            _link: crypto_1.default.randomBytes(32).toString('hex')
        });
        try {
            yield db.put(v2);
            t.fail('conditional check should have failed');
        }
        catch (err) {
            t.equals(err.name, 'ConditionalCheckFailedException');
        }
        build_resource_1.default.setVirtual(v2, {
            _time: v1._time + 1,
            _link: crypto_1.default.randomBytes(32).toString('hex')
        });
        yield db.put(v2);
        t.same(yield db.get({
            [constants_1.TYPE]: FORM_REQUEST,
            _permalink: v2._permalink
        }), v2);
        t.end();
    })));
    testNamed('db', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield reload(indexes);
        const req = formRequests[0];
        const type = req[constants_1.TYPE];
        const link = req._link;
        const permalink = req._permalink;
        t.same(yield db.get({
            [constants_1.TYPE]: type,
            _permalink: permalink
        }), req, 'db.get');
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
        // try {
        //   await db.latest({
        //     [TYPE]: type,
        //     _permalink: permalink
        //   })
        //   t.fail('expected NotFound error')
        // } catch (err) {
        //   t.equal(err.name, 'NotFound')
        // }
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
    testNamed('filters', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield reload(indexes);
        const type = 'tradle.PhotoID';
        const photoIds = resources.filter(item => item[constants_1.TYPE] === type);
        // const byType = groupByType(resources)
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
        const tests = orderByCombinations.map(orderBy => () => tslib_1.__awaiter(this, void 0, void 0, function* () {
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
            const badCountries = photoIds.slice(0, 2).map(photoId => photoId.country.id);
            expected = photoIds.slice(2).filter(photoId => {
                return !badCountries.includes(photoId.country.id);
            });
            if (!expected.length)
                throw new Error('bad test, need more fixtures');
            sortResults({ results: expected, orderBy });
            const photoIdsCountryNotIn = yield db.find({
                orderBy,
                filter: {
                    EQ: {
                        [constants_1.TYPE]: type
                    },
                    NOT_IN: {
                        'country.id': badCountries
                    }
                }
            });
            t.same(photoIdsCountryNotIn.items, expected, 'country not in..');
            let select = ['documentType', 'country'];
            expected = photoIds.slice();
            sortResults({ results: expected, orderBy });
            expected = expected.map(photoId => lodash_1.default.pick(photoId, select));
            const photoIdsSelect = yield db.find({
                select,
                orderBy,
                filter: {
                    EQ: {
                        [constants_1.TYPE]: type
                    }
                }
            });
            t.same(photoIdsSelect.items, expected, 'select subset of attributes');
        }));
        for (const test of tests) {
            yield test();
        }
        t.end();
    })));
    testNamed('custom primary keys', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield reload(indexes);
        const ALIEN_CLASSIFIER = 'mynamespace.Alien' + Date.now();
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
        db.modelStore.addModel(alienModel);
        db.setExclusive({
            table: _1.createTable({
                objects,
                docClient,
                // ...getCommonTableOpts(DB.getSafeTableName(alienModel.id)),
                model: alienModel,
                models: db.models,
                tableDefinition: utils_1.getTableDefinitionForModel({
                    models: db.models,
                    model: alienModel
                }),
                getIndexesForModel: model => [],
                exclusive: true
            })
        });
        yield db.tables[ALIEN_CLASSIFIER].create();
        const updatedModels = db.models;
        const alien = build_resource_1.default({
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
        yield db.tables[ALIEN_CLASSIFIER].put(alien);
        t.same(yield db.get({
            [constants_1.TYPE]: ALIEN_CLASSIFIER,
            color: alien.color,
            fingerCount: alien.fingerCount
        }), alien);
        const searchResult = yield db.find({
            orderBy: {
                property: 'fingerCount'
            },
            filter: {
                EQ: {
                    [constants_1.TYPE]: ALIEN_CLASSIFIER,
                    color: alien.color
                },
                GT: {
                    fingerCount: alien.fingerCount - 1
                }
            }
        });
        t.same(searchResult.items, [alien]);
        t.end();
    })));
    testNamed('cleanup', (t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield cleanup(indexes);
        t.end();
    }));
});
tape_1.default('multiple types, overloaded indexes', loudAsync((t) => tslib_1.__awaiter(this, void 0, void 0, function* () {
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
    };
    const myModels = Object.assign({}, models, { [eventModel.id]: eventModel });
    const getIndexesForModel = ({ model, table }) => {
        if (model.id === eventModel.id) {
            return eventModel.indexes.map(utils_1.normalizeIndexedPropertyTemplateSchema);
        }
        return defaults.indexes.concat(model.indexes || []).map(utils_1.normalizeIndexedPropertyTemplateSchema);
    };
    const table = new _1.Table({
        docClient,
        models: myModels,
        modelsStored: myModels,
        // objects,
        allowScan: false,
        tableDefinition: def,
        derivedProps: tableKeys,
        deriveProps: defaults.deriveProps,
        getIndexesForModel
    });
    const event = {
        [constants_1.TYPE]: 'tradle.Event',
        topic: 'user:online',
        time: new Date('2000-01-01').getTime(),
        payload: {
            user: 'bob',
        }
    };
    const contactInfo = {
        [constants_1.TYPE]: 'tradle.BasicContactInfo',
        [constants_1.SIG]: 'abc',
        firstName: 'bob',
        lastName: 'gleggknook',
        email: 'bobg@knook.com',
        _author: 'bobhash',
        _link: 'aaa',
        _permalink: 'aaa',
        _time: new Date('2000-01-01').getTime()
    };
    const items = [event, contactInfo];
    yield table.create();
    yield Promise.all(items.map(item => table.put(item)));
    const foundContactInfo = yield table.findOne({
        orderBy: {
            property: '_time',
            desc: false
        },
        filter: {
            EQ: {
                [constants_1.TYPE]: contactInfo[constants_1.TYPE],
                _author: contactInfo._author
            }
        }
    });
    t.same(foundContactInfo, contactInfo);
    const foundEvent = yield table.findOne({
        filter: {
            EQ: {
                [constants_1.TYPE]: event[constants_1.TYPE],
                topic: event.topic
            }
        }
    });
    t.same(foundEvent, event);
    // const results = await new Promise((resolve, reject) => {
    //   table.table.scan().exec((err, results) => {
    //     if (err) return reject(err)
    //     resolve(results.Items.map(item => item.toJSON()))
    //   })
    // })
    // console.log('table', def.tableName, JSON.stringify(results, null, 2))
    yield Promise.all(def.indexes.map((index, i) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        const indexed = yield docClient.scan({
            TableName: def.tableName,
            IndexName: index.name
        }).promise();
        const expectedCount = items.map(item => {
            const model = myModels[item[constants_1.TYPE]];
            const indexes = getIndexesForModel({ table, model });
            return indexes[i] ? 1 : 0;
        })
            .reduce((sum, num) => sum + num, 0);
        t.equal(indexed.Items.length, expectedCount);
        // console.log('index', index.name, JSON.stringify(indexed, null, 2))
    })));
    yield table.destroy();
    t.end();
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
})));
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
function loudAsync(asyncFn) {
    return (...args) => tslib_1.__awaiter(this, void 0, void 0, function* () {
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
function byLinkAsc(a, b) {
    return a._link < b._link ? -1 : a._link > b._link ? 1 : 0;
}
function toProjectionTypeAll(index) {
    return Object.assign({}, index, { projection: {
            ProjectionType: 'ALL'
        } });
}
function getItemPosition({ db, filter, orderBy, item }) {
    return utils_1.getQueryInfo({
        type: filter.EQ[constants_1.TYPE],
        table: db.tables[filter.EQ[constants_1.TYPE]],
        filter,
        orderBy
    }).itemToPosition(item);
}
//# sourceMappingURL=index.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
require('source-map-support').install();
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const tape_1 = tslib_1.__importDefault(require("tape"));
const dynogels_1 = tslib_1.__importDefault(require("dynogels"));
const just_diff_1 = require("just-diff");
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
const search_1 = require("../search");
const constants_2 = require("../constants");
const utils = tslib_1.__importStar(require("../utils"));
const { wait, runWithBackoffOnTableNotExists, getTableDefinitionForModel, getQueryInfo, toDynogelTableDefinition, getVariablesInTemplate, normalizeIndexedPropertyTemplateSchema } = utils;
const utils_1 = require("./utils");
const sortResults = opts => utils.sortResults(Object.assign({ defaultOrderBy: constants_2.defaultOrderBy }, opts));
const { logger } = defaults;
dynogels_1.default.log = {
    info: logger.debug,
    warn: logger.debug,
    level: 'info'
};
const resources = require('./fixtures/resources.json');
const tableSchema = require('./fixtures/table-schema.json');
const def = toDynogelTableDefinition(Object.assign({}, tableSchema, { TableName: 'test-resources-' + Date.now() }));
const tableKeys = utils.getTableKeys(def);
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
        get: async (link) => {
            const match = cache[link];
            if (match)
                return match;
            throw new Error('NotFound');
        },
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
    return utils_1.createDB({
        tableNames: lastCreated,
        docClient,
        objects,
        models,
        indexes
    });
};
const cleanup = async (indexes) => {
    if (!lastCreated.length)
        return;
    db = createDB(indexes);
    await db.destroyTables();
};
const validResources = resources.filter(resource => {
    try {
        validate_resource_1.default({ models, resource });
        return true;
    }
    catch (err) { }
});
const numTables = 1;
const reload = async (indexes) => {
    await cleanup(indexes);
    const prefix = '' + (offset++);
    lastCreated = lodash_1.default.range(0, numTables).map(i => prefix + i);
    db = createDB(indexes);
    await db.createTables();
    // await db.batchPut(validResources)
    await db.batchPut(formRequests);
    // table = db.tables[FORM_REQUEST]
    // await db.batchPut(formRequests)
};
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
        { hashKey: ['a', 'b'], rangeKey: { template: '{a}{b}{c}' } },
    ].map(normalizeIndexedPropertyTemplateSchema), [
        { hashKey: { template: '{a}' } },
        { hashKey: { template: '{a}' } },
        { hashKey: { template: '{a}{b}' } },
        { hashKey: { template: '{a}{b}{c}' } },
        { hashKey: { template: '{a}{b}' }, rangeKey: { template: '{a}{b}{c}' } },
        { hashKey: { template: '{a}{b}' }, rangeKey: { template: '{a}{b}{c}' } },
    ]);
    t.same(getVariablesInTemplate('{a}lala{b}'), ['a', 'b']);
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
    t.same(utils.deriveProps({
        table,
        item: {
            [constants_1.TYPE]: model.id,
            firstName: 'Bob'
        },
        isRead: false
    }), { __r__: '_' }, 'deriveProps skips templates with missing vars');
    const derived = utils.deriveProps({
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
    }, 'deriveProps');
    t.same(utils.parseDerivedProps({
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
tape_1.default('model store', loudAsync(async (t) => {
    let externalSource = models;
    let i = 0;
    const onMissingModel = async (id) => {
        i++;
        store.addModels(lodash_1.default.pick(externalSource, ['tradle.Object', 'tradle.Seal']));
        return externalSource[id];
    };
    const store = _1.createModelStore({
        onMissingModel
    });
    t.same(await store.get('tradle.Object'), externalSource['tradle.Object']);
    t.equal(i, 1);
    try {
        await store.get('dsahjdksa');
        t.fail('expected not found');
    }
    catch (err) {
        t.ok(/not found/i.test(err.message));
    }
    t.end();
}));
tape_1.default('minify (big values)', function (t) {
    const bigMsg = {
        [constants_1.TYPE]: 'tradle.SimpleMessage',
        message: 'blah'.repeat(1000),
        shortMessage: 'blah'.repeat(10)
    };
    // fake table
    const table = {
        logger,
        models,
        indexes: utils_1.defaultIndexes
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
        logger,
        models: customModels,
        indexes: utils_1.defaultIndexes
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
        logger,
        models: customModels,
        indexes: utils_1.defaultIndexes
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
tape_1.default('backoff after create', loudAsync(async (t) => {
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
    let result = await runWithBackoffOnTableNotExists(async () => {
        if (failsLeft-- > 0) {
            throw errThatCausesBackoff;
        }
        return expectedResult;
    }, backoffOpts);
    t.equal(result, expectedResult);
    try {
        result = await runWithBackoffOnTableNotExists(async () => {
            throw errThatCausesExit;
        }, backoffOpts);
        t.fail('expected error');
    }
    catch (err) {
        t.equal(err, errThatCausesExit);
    }
    const start = Date.now();
    try {
        result = await runWithBackoffOnTableNotExists(async () => {
            throw errThatCausesBackoff;
        }, backoffOpts);
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
}));
tape_1.default('db hooks', loudAsync(async (t) => {
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
        await db.put(item);
        t.fail('expected error');
    }
    catch (err) {
        t.equal(err.message, 'boo');
    }
    t.end();
}));
let only;
[
    utils_1.defaultIndexes,
    utils_1.defaultIndexes.map(toProjectionTypeAll)
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
    testNamed('put/update', loudAsync(async (t) => {
        await reload(indexes);
        const photoId = photoIds[0];
        await db.put(photoId);
        const keys = {
            [constants_1.TYPE]: photoId[constants_1.TYPE],
            _link: photoId._link,
            _permalink: photoId._permalink
        };
        const saved = await db.get(keys);
        t.same(saved, photoId);
        const update = Object.assign({}, keys, { _displayName: 'blah' });
        const expected = Object.assign({}, photoId, update);
        await db.update(update, {
            diff: just_diff_1.diff(photoId, expected)
        });
        const updated = await db.get({
            [constants_1.TYPE]: photoId[constants_1.TYPE],
            _permalink: photoId._permalink
        });
        t.same(updated, expected);
        t.end();
    }));
    testNamed('basic pagination', loudAsync(async (t) => {
        await reload(indexes);
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
        const page1 = await db.find({
            filter,
            orderBy,
            limit: 5
        });
        t.same(page1.items, expected.slice(0, 5));
        // search in reverse
        const page1Again = await db.find({
            filter,
            orderBy: Object.assign({}, orderBy, { desc: !orderBy.desc }),
            checkpoint: page1.endPosition,
            limit: 4
        });
        const reverseFirstPage = expected.slice(0, 4).reverse();
        t.same(page1Again.items, reverseFirstPage, '"before" works');
        t.same(page1Again.startPosition, getItemPosition({
            db,
            filter: search_1.expandFilter(db.tables[FORM_REQUEST], filter),
            orderBy,
            item: reverseFirstPage[0]
        }));
        t.same(page1Again.endPosition, page1.startPosition);
        const page2 = await db.find({
            filter,
            orderBy,
            checkpoint: page1.endPosition,
            limit: 5
        });
        t.same(page2.items, expected.slice(5, 10));
        const page3 = await db.find({
            filter,
            orderBy,
            checkpoint: page2.endPosition
        });
        t.same(page3.items, expected.slice(10));
        t.end();
    }));
    testNamed('orderBy', loudAsync(async (t) => {
        await reload(indexes);
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
        const page1 = await db.find({
            filter,
            orderBy,
            limit: 5
        });
        t.same(page1.items, expected.slice(0, 5));
        const page2 = await db.find({
            filter,
            checkpoint: page1.endPosition,
            orderBy,
            limit: 5
        });
        // console.log(page2.items.map(i => i.form), expected.slice(5, 10).map(i => i.form))
        t.same(page2.items, expected.slice(5, 10));
        const page3 = await db.find({
            filter,
            checkpoint: page2.endPosition,
            orderBy
        });
        t.same(page3.items, expected.slice(10));
        // and in reverse
        expected.reverse();
        orderBy.desc = true;
        sortResults({ results: expected, orderBy });
        const desc1 = await db.find({
            filter,
            orderBy,
            limit: 5
        });
        t.same(desc1.items, expected.slice(0, 5));
        t.end();
    }));
    testNamed('indexed props (_author)', loudAsync(async (t) => {
        await reload(indexes);
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
        const page1 = await db.find({
            orderBy,
            filter,
            limit: 5
        });
        t.same(page1.items, expected.slice(0, 5));
        const page2 = await db.find({
            checkpoint: page1.endPosition,
            filter,
            orderBy,
            limit: 5
        });
        t.same(page2.items, expected.slice(5, 10));
        const page3 = await db.find({
            checkpoint: page2.endPosition,
            filter,
            orderBy
        });
        t.same(page3.items, expected.slice(10, 20));
        t.end();
    }));
    testNamed('indexed props (_t)', loudAsync(async (t) => {
        await reload(indexes);
        await db.batchPut(formRequests);
        await db.batchPut(photoIds);
        await Promise.all([photoIds, formRequests].map(async (dataset) => {
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
            const page1 = await db.find({
                orderBy,
                filter,
                limit: 5
            });
            t.same(page1.items, expected.slice(0, 5));
            const page2 = await db.find({
                checkpoint: page1.endPosition,
                filter,
                orderBy,
                limit: 5
            });
            t.same(page2.items, expected.slice(5, 10));
            const page3 = await db.find({
                checkpoint: page2.endPosition,
                filter,
                orderBy
            });
            t.same(page3.items, expected.slice(10, 20));
        }));
        t.end();
    }));
    // testNamed('latest', loudAsync(async (t) => {
    //   await reload(indexes)
    //   const v1 = formRequests[0]
    //   await db.put(v1)
    //   const v2 = { ...v1 }
    //   v2[SIG] = crypto.randomBytes(128).toString('base64')
    //   v2[PERMALINK] = v2._permalink
    //   v2[PREVLINK] = v2._link
    //   buildResource.setVirtual(v2, {
    //     _time: v1._time - 1,
    //     _link: crypto.randomBytes(32).toString('hex')
    //   })
    //   try {
    //     await db.put(v2)
    //     t.fail('conditional check should have failed')
    //   } catch (err) {
    //     t.equals(err.name, 'ConditionalCheckFailedException')
    //   }
    //   buildResource.setVirtual(v2, {
    //     _time: v1._time + 1,
    //     _link: crypto.randomBytes(32).toString('hex')
    //   })
    //   await db.put(v2)
    //   t.same(await db.get({
    //     [TYPE]: FORM_REQUEST,
    //     _permalink: v2._permalink
    //   }), v2)
    //   t.end()
    // }))
    testNamed('db', loudAsync(async (t) => {
        await reload(indexes);
        const req = formRequests[0];
        const type = req[constants_1.TYPE];
        const link = req._link;
        const permalink = req._permalink;
        t.same(await db.get({
            [constants_1.TYPE]: type,
            _permalink: permalink
        }), req, 'db.get');
        await db.del({
            [constants_1.TYPE]: type,
            _permalink: permalink
        });
        try {
            await db.get({
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
        await db.put(req);
        t.same(await db.get({
            [constants_1.TYPE]: type,
            _permalink: permalink
        }), req);
        const searchResult = await db.find({
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
    }));
    testNamed('filters', loudAsync(async (t) => {
        await reload(indexes);
        const type = 'tradle.PhotoID';
        const photoIds = resources.filter(item => item[constants_1.TYPE] === type);
        // const byType = groupByType(resources)
        // photoIds.forEach(objects.put)
        await db.batchPut(photoIds);
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
        const tests = orderByCombinations.map(orderBy => async () => {
            const first = photoIds[0];
            let expected;
            const startsWithStr = 'tradle.';
            expected = photoIds.filter(photoId => {
                return photoId.country.id.startsWith(startsWithStr);
            });
            sortResults({ results: expected, orderBy });
            const countryIdStartsWith = await db.find({
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
            const photoIdsGt = await db.find({
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
            const photoIdsIn = await db.find({
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
            const photoIdsCountryNull = await db.find({
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
            const photoIdsCountryNotNull = await db.find({
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
            const photoIdsCountryNotIn = await db.find({
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
            let select = ['documentType', 'country', constants_1.TYPE];
            expected = photoIds.slice();
            sortResults({ results: expected, orderBy });
            expected = expected.map(photoId => lodash_1.default.pick(photoId, select));
            const photoIdsSelect = await db.find({
                select,
                orderBy,
                filter: {
                    EQ: {
                        [constants_1.TYPE]: type
                    }
                }
            });
            t.ok(photoIdsSelect.items.every((item, i) => {
                return lodash_1.default.isEqual(lodash_1.default.pick(item, select), expected[i]);
            }), 'select subset of attributes');
            // t.same(photoIdsSelect.items, expected, 'select subset of attributes')
        });
        for (const test of tests) {
            await test();
        }
        t.end();
    }));
    testNamed('custom primary keys', loudAsync(async (t) => {
        await reload(indexes);
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
                tableDefinition: getTableDefinitionForModel({
                    models: db.models,
                    model: alienModel
                }),
                getIndexesForModel: model => [],
                exclusive: true
            })
        });
        await db.tables[ALIEN_CLASSIFIER].create();
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
        await db.tables[ALIEN_CLASSIFIER].put(alien);
        t.same(await db.get({
            [constants_1.TYPE]: ALIEN_CLASSIFIER,
            color: alien.color,
            fingerCount: alien.fingerCount
        }), alien);
        const searchResult = await db.find({
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
    }));
    testNamed('compound indexes', loudAsync(async (t) => {
        await reload(indexes);
        const COMPOUNDER = 'mynamespace.MultiAuthored' + Date.now();
        const model = {
            type: 'tradle.Model',
            id: COMPOUNDER,
            title: 'Multi Authored',
            properties: {
                org: {
                    type: 'string'
                },
                orgOrAuthor: {
                    type: 'string'
                }
            },
            indexes: [
                {
                    hashKey: 'orgOrAuthor',
                    rangeKey: ['_t', '_time', '_author']
                }
            ]
        };
        db.modelStore.addModel(model);
        const updatedModels = db.models;
        const resource = build_resource_1.default({
            models: updatedModels,
            model
        })
            .set({
            org: 'Coca Cola',
            _link: 'abc',
            _permalink: 'abc',
            _author: 'Bob',
            _time: Date.now(),
            orgOrAuthor: 'Coca Cola'
        })
            .toJSON();
        await Promise.all([
            db.put(resource),
            objects.put(resource)
        ]);
        const searchResult = await db.find({
            filter: {
                EQ: {
                    [constants_1.TYPE]: COMPOUNDER,
                    orgOrAuthor: resource.org
                }
            },
            orderBy: {
                property: '_time'
            }
        });
        t.same(searchResult.items, [resource]);
        t.end();
    }));
    testNamed('cleanup', async (t) => {
        await cleanup(indexes);
        t.end();
    });
});
tape_1.default('multiple types, overloaded indexes', loudAsync(async (t) => {
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
                hashKey: 'payload.user',
                rangeKey: 'time'
            }
        ]
    };
    const myModels = Object.assign({}, models, { [eventModel.id]: eventModel });
    const getIndexesForModel = ({ model, table }) => {
        if (model.id === eventModel.id) {
            return eventModel.indexes.map(normalizeIndexedPropertyTemplateSchema);
        }
        return defaults.indexes.concat(model.indexes || []).map(normalizeIndexedPropertyTemplateSchema);
    };
    const table = new _1.Table({
        docClient,
        models: myModels,
        modelsStored: myModels,
        // objects,
        allowScan: false,
        tableDefinition: def,
        derivedProps: tableKeys,
        deriveProps: utils.deriveProps,
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
    await table.create();
    await Promise.all(items.map(item => table.put(item)));
    const foundContactInfo = await table.findOne({
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
    const foundEvent = await table.findOne({
        filter: {
            EQ: {
                [constants_1.TYPE]: event[constants_1.TYPE],
                topic: event.topic
            }
        }
    });
    t.same(foundEvent, event);
    const gotEvent = await table.get({
        [constants_1.TYPE]: event[constants_1.TYPE],
        payload: {
            user: event.payload.user
        },
        time: event.time
    });
    t.same(gotEvent, event, 'get() falls back to index');
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
        }).promise();
        const expectedCount = items.map(item => {
            const model = myModels[item[constants_1.TYPE]];
            const indexes = getIndexesForModel({ table, model });
            return indexes[i] ? 1 : 0;
        })
            .reduce((sum, num) => sum + num, 0);
        t.equal(indexed.Items.length, expectedCount);
        // console.log('index', index.name, JSON.stringify(indexed, null, 2))
    }));
    await table.destroy();
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
}));
tape_1.default('reindex', loudAsync(async (t) => {
    const model = {
        type: 'tradle.Model',
        id: 'tradle.Namey1',
        title: 'Namey name1',
        properties: {
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            nickName: { type: 'string' },
        },
        required: ['firstName', 'lastName'],
        indexes: [
            {
                hashKey: '_t',
                rangeKey: '_time',
            },
            {
                hashKey: 'firstName',
                rangeKey: 'lastName',
            }
        ]
    };
    const models = { [model.id]: model };
    const tableOpts = {
        objects,
        docClient,
        model,
        models,
        tableDefinition: tableSchema,
        derivedProps: tableKeys
    };
    const tableV1 = _1.createTable(tableOpts);
    tableV1.storeResourcesForModel({ model });
    const startTime = new Date('2000-01-01').getTime();
    const names = [
        { firstName: 'a', lastName: 'b', nickName: 'c' },
        { firstName: 'd', lastName: 'e', nickName: 'f' },
        { firstName: 'g', lastName: 'h', nickName: 'i' },
        { firstName: 'j', lastName: 'k', nickName: 'l' },
    ].map((n, i) => (Object.assign({ _t: model.id, _time: startTime + i, _permalink: startTime + i + '' }, n)));
    await tableV1.destroy();
    await tableV1.create();
    await tableV1.batchPut(names);
    t.same((await tableV1.list(model.id)).items, names);
    model.indexes.push({
        hashKey: 'nickName',
        rangeKey: 'lastName',
    });
    const tableV2 = _1.createTable(tableOpts);
    tableV2.storeResourcesForModel({ model });
    await tableV2.reindex({ model });
    const search = new search_1.Search({
        table: tableV2,
        allowScan: false,
        filter: {
            EQ: {
                _t: model.id,
                nickName: names[0].nickName,
            }
        }
    });
    t.equal(search.index.hashKey, tableV2.indexes[2].hashKey);
    const { items } = await search.exec();
    t.equal(items.length, 1);
    t.same(tableV2.exportResource(items[0]), names[0]);
    t.end();
}));
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
    return async (...args) => {
        try {
            return await asyncFn(...args);
        }
        catch (err) {
            console.error(err);
            throw err;
        }
    };
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
        // flatten
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
    return getQueryInfo({
        type: filter.EQ[constants_1.TYPE],
        table: db.tables[filter.EQ[constants_1.TYPE]],
        filter,
        orderBy
    }).itemToPosition(item);
}
//# sourceMappingURL=index.js.map
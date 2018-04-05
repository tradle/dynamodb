"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = require("lodash");
const constants_1 = require("@tradle/constants");
const constants_2 = require("../constants");
const prefix_1 = require("../prefix");
const hooks_1 = require("../hooks");
const _1 = require("../");
const cloudformation = require('./fixtures/table-schema.json');
const tableDefinition = _1.utils.toDynogelTableDefinition(cloudformation);
exports.defaultTableDefinition = tableDefinition;
exports.defaultIndexes = tableDefinition.indexes;
const getDefaultderiveProps = (def) => ({ item, isRead }) => {
    const derived = {};
    if (item[constants_1.TYPE] && item._permalink) {
        derived[def.hashKey] = [item._permalink, item[constants_1.TYPE]].join(constants_2.separator);
        derived[def.rangeKey] = '__placeholder__';
    }
    if (item._author) {
        derived[def.indexes[0].hashKey] = ['_author', item._author].join(constants_2.separator);
    }
    if (item[constants_1.TYPE]) {
        derived[def.indexes[1].hashKey] = [constants_1.TYPE, item[constants_1.TYPE]].join(constants_2.separator);
    }
    if (item._time) {
        derived[def.indexes[0].rangeKey] =
            derived[def.indexes[1].rangeKey] = String(item._time);
    }
    const rangeKeys = def.indexes.map(def => def.rangeKey)
        .concat(def.rangeKey)
        .filter(lodash_1.identity);
    return prefix_1.prefixValues(derived, 'tradle.Object', rangeKeys);
};
exports.getCommonTableOpts = (tableName, indexes) => {
    const def = Object.assign({}, tableDefinition, { tableName, indexes: indexes || tableDefinition.indexes });
    const derivedProps = lodash_1.flatten([
        def.hashKey,
        def.rangeKey,
    ].concat(def.indexes.map(i => [i.hashKey, i.rangeKey])))
        .filter(i => i);
    return {
        maxItemSize: 4000,
        validate: false,
        tableDefinition: def,
        derivedProps,
        deriveProps: getDefaultderiveProps(def),
        resolveOrderBy: ({ type, hashKey, property }) => {
            if (hashKey !== def.hashKey && property === '_time') {
                return def.indexes
                    .find(index => index.hashKey === hashKey)
                    .rangeKey;
            }
            return property;
        }
    };
};
exports.createDB = ({ models, objects, docClient, indexes, tableNames }) => {
    const db = new _1.DB({
        modelStore: _1.createModelStore({ models }),
        tableNames,
        // tableNames: lastCreated,
        defineTable: name => {
            const opts = exports.getCommonTableOpts(_1.DB.getSafeTableName(name), indexes);
            const table = new _1.Table(Object.assign({}, opts, { models,
                objects,
                docClient }));
            table.hook('put:pre', hooks_1.createControlLatestHook(table, 'put'));
            table.hook('update:pre', hooks_1.createControlLatestHook(table, 'update'));
            return table;
        }
    });
    return db;
};
//# sourceMappingURL=utils.js.map
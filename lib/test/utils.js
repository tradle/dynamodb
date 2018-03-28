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
const getDefaultDeriveProperties = (def) => (resource, forRead) => {
    const derived = {};
    if (resource[constants_1.TYPE] && resource._permalink) {
        derived[def.hashKey] = [resource._permalink, resource[constants_1.TYPE]].join(constants_2.separator);
        derived[def.rangeKey] = '__placeholder__';
    }
    if (resource._author) {
        derived[def.indexes[0].hashKey] = ['_author', resource._author].join(constants_2.separator);
    }
    if (resource[constants_1.TYPE]) {
        derived[def.indexes[1].hashKey] = [constants_1.TYPE, resource[constants_1.TYPE]].join(constants_2.separator);
    }
    if (resource._time) {
        derived[def.indexes[0].rangeKey] =
            derived[def.indexes[1].rangeKey] = String(resource._time);
    }
    const rangeKeys = def.indexes.map(def => def.rangeKey)
        .concat(def.rangeKey)
        .filter(lodash_1.identity);
    return prefix_1.prefixValues(derived, 'tradle.Object', rangeKeys);
};
exports.getCommonTableOpts = (tableName, indexes) => {
    const def = Object.assign({}, tableDefinition, { tableName, indexes: indexes || tableDefinition.indexes });
    const derivedProperties = lodash_1.flatten([
        def.hashKey,
        def.rangeKey,
    ].concat(def.indexes.map(i => [i.hashKey, i.rangeKey])))
        .filter(i => i);
    return {
        maxItemSize: 4000,
        validate: false,
        tableDefinition: def,
        derivedProperties,
        deriveProperties: getDefaultDeriveProperties(def),
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
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// import { createControlLatestHook } from '../hooks'
const _1 = require("../");
const cloudformation = require('./fixtures/table-schema.json');
const tableDefinition = _1.utils.toDynogelTableDefinition(cloudformation);
exports.defaultTableDefinition = tableDefinition;
exports.defaultIndexes = tableDefinition.indexes;
exports.getCommonTableOpts = (tableName, indexes) => {
    const def = Object.assign({}, tableDefinition, { tableName, indexes: indexes || tableDefinition.indexes });
    return {
        maxItemSize: 4000,
        validate: false,
        tableDefinition: def,
        derivedProps: _1.utils.getTableKeys(def),
        deriveProps: _1.utils.deriveProps,
        resolveOrderBy: _1.utils.resolveOrderBy
        // deriveProps: getDefaultderiveProps(def),
        // resolveOrderBy: ({ type, hashKey, property }) => {
        //   if (hashKey !== def.hashKey && property === '_time') {
        //     return def.indexes
        //       .find(index => index.hashKey === hashKey)
        //       .rangeKey
        //   }
        //   return property
        // }
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
            // table.hook('put:pre', createControlLatestHook(table, 'put'))
            // table.hook('update:pre', createControlLatestHook(table, 'update'))
            return table;
        }
    });
    return db;
};
//# sourceMappingURL=utils.js.map
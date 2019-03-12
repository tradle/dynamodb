"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// import { createControlLatestHook } from '../hooks'
const __1 = require("../");
const cloudformation = require('./fixtures/table-schema.json');
const tableDefinition = __1.utils.toDynogelTableDefinition(cloudformation);
exports.defaultTableDefinition = tableDefinition;
exports.defaultIndexes = tableDefinition.indexes;
exports.getCommonTableOpts = (tableName, indexes) => {
    const def = Object.assign({}, tableDefinition, { tableName, indexes: indexes || tableDefinition.indexes });
    return {
        maxItemSize: 4000,
        validate: false,
        tableDefinition: def,
        derivedProps: __1.utils.getTableKeys(def),
        deriveProps: __1.utils.deriveProps,
        resolveOrderBy: __1.utils.resolveOrderBy
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
    const db = new __1.DB({
        modelStore: __1.createModelStore({ models }),
        tableNames,
        // tableNames: lastCreated,
        defineTable: name => {
            const opts = exports.getCommonTableOpts(__1.DB.getSafeTableName(name), indexes);
            const table = new __1.Table(Object.assign({}, opts, { models,
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
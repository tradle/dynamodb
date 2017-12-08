"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const crypto = require("crypto");
const debug = require('debug')(require('../package.json').name);
const bindAll = require("bindall");
const clone = require("clone");
const shallowClone = require("xtend");
const extend = require("xtend/mutable");
const deepEqual = require("deep-equal");
const pick = require("object.pick");
const omit = require("object.omit");
const promisify = require("pify");
const dotProp = require("dot-prop");
const levenshtein = require("fast-levenshtein");
const Joi = require("joi");
const toJoi = require("@tradle/schema-joi");
const constants_1 = require("@tradle/constants");
const constants_2 = require("./constants");
const OPERATORS = require("./operators");
const object_model_1 = require("./object-model");
const metadataTypes = toJoi({
    model: object_model_1.default
});
const levenshteinDistance = (a, b) => levenshtein.get(a, b);
function getTableName({ model, prefix = '', suffix = '' }) {
    const name = (model.id || model).replace(/[.]/g, '_');
    return prefix + name + suffix;
}
function getIndexes(model) {
    return constants_2.defaultIndexes.slice();
}
function sortResults({ results, orderBy = constants_2.defaultOrderBy }) {
    const { property, desc } = orderBy;
    const asc = !desc; // easier to think about
    if (property === constants_2.defaultOrderBy.property) {
        return results.sort((a, b) => compare(a, b, property, asc));
    }
    return results.sort(function (a, b) {
        return compare(a, b, property, asc) ||
            compare(a, b, constants_2.defaultOrderBy.property, asc);
    });
}
function compare(a, b, propertyName, asc) {
    const aVal = dotProp.get(a, propertyName);
    const bVal = dotProp.get(b, propertyName);
    if (aVal < bVal)
        return asc ? -1 : 1;
    if (aVal > bVal)
        return asc ? 1 : -1;
    return 0;
}
function toObject(arr) {
    const obj = {};
    for (let val of arr) {
        obj[val] = true;
    }
    return obj;
}
function fromResourceStub(props) {
    const [type, permalink, link] = props.id.split('_');
    return {
        [constants_1.TYPE]: type,
        link,
        permalink
    };
}
function resultsToJson(items) {
    // return items
    if (Array.isArray(items)) {
        return items.map(item => {
            return item.toJSON ? item.toJSON() : item;
        });
    }
    return items.toJSON ? items.toJSON() : items;
}
function getUsedProperties(filter) {
    const flat = flatten(filter);
    const props = flat.reduce((all, more) => {
        extend(all, more);
        return all;
    }, {});
    return Object.keys(props);
}
/**
 * flattens nested filter
 *
 * has no semantic meaning, this is just to be able to check
 * which props are being filtered against
 */
function flatten(filter) {
    const flat = [];
    const batch = [filter];
    let len = batch.length;
    while (batch.length) {
        let copy = batch.slice();
        batch.length = 0;
        copy.forEach(subFilter => {
            for (let op in subFilter) {
                if (op in OPERATORS) {
                    batch.push(subFilter[op]);
                }
                else {
                    flat.push(subFilter);
                }
            }
        });
    }
    return flat;
}
// function getLeaves (obj) {
//   return traverse(obj).reduce(function (acc, value) {
//     if (this.isLeaf) {
//       return acc.concat({
//         path: this.path,
//         value
//       })
//     }
//     return acc
//   }, [])
// }
const OriginalBaseObjectModel = require('@tradle/models').models['tradle.Object'];
const ObjectModelKeys = Object.keys(OriginalBaseObjectModel.properties);
const getModelProperties = model => {
    return uniqueStrict(Object.keys(model.properties).concat(ObjectModelKeys));
};
const getMissingProperties = ({ resource, model, opts }) => {
    let { select } = opts;
    if (!select) {
        select = getModelProperties(model);
    }
    const missing = select.filter(prop => !(prop in resource));
    if (!missing.length)
        return missing;
    const cut = resource[constants_2.minifiedFlag];
    if (cut && cut.length) {
        const needsInflate = cut.some(prop => select.includes(prop));
        if (!needsInflate)
            return resource;
    }
    return missing;
};
function getPreferredQueryProperty({ table, properties }) {
    if (properties.length > 1) {
        const { indexes } = table;
        const projectsAll = indexes.find(index => {
            return properties.includes(index.hashKey) &&
                index.projection.ProjectionType === 'ALL';
        });
        if (projectsAll) {
            return {
                index: projectsAll,
                property: projectsAll.hashKey,
                rangeKey: projectsAll.rangeKey
            };
        }
        if (properties.includes(table.hashKey)) {
            return {
                property: table.hashKey,
                rangeKey: table.rangeKey
            };
        }
    }
    const property = properties[0];
    if (property === table.hashKey) {
        return {
            property,
            rangeKey: table.rangeKey
        };
    }
    const index = getIndexForProperty({ table, property });
    return {
        index,
        property,
        rangeKey: index && index.rangeKey
    };
}
function getIndexForProperty({ table, property }) {
    return table.indexes.find(({ hashKey }) => hashKey === property);
}
// function getIndexHashKeyAttributeName (index:AWS.DynamoDB.Types.GlobalSecondaryIndex):string {
//   return index.KeySchema
//     .find(({ KeyType }) => KeyType === 'HASH')
//     .AttributeName
// }
function getQueryInfo({ table, filter, orderBy }) {
    // orderBy is not counted, because for a 'query' op,
    // a value for the indexed prop must come from 'filter'
    const usedProps = getUsedProperties(filter);
    const { primaryKeys } = table;
    const { indexes } = table;
    const { hashKey, rangeKey } = primaryKeys;
    const primaryKeysArr = getValues(primaryKeys);
    const indexedProps = indexes.map(index => index.hashKey)
        .concat(hashKey);
    const indexedPropsMap = toObject(indexedProps);
    const { EQ = {} } = filter;
    const usedIndexedProps = usedProps.filter(prop => {
        return prop in EQ && prop in indexedPropsMap;
    });
    const opType = usedIndexedProps.length
        ? 'query'
        : 'scan';
    let builder;
    let queryProp;
    let sortedByDB;
    let index;
    if (opType === 'query') {
        // supported key condition operators:
        // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions
        const preferred = getPreferredQueryProperty({ table, properties: usedIndexedProps });
        queryProp = preferred.property;
        index = preferred.index;
        if (orderBy.property === preferred.rangeKey) {
            sortedByDB = true;
        }
    }
    const itemToPosition = function itemToPosition(item) {
        if (!item)
            throw new Error('expected database record');
        if (queryProp === hashKey || opType === 'scan') {
            return pick(item, primaryKeysArr);
        }
        const props = [index.hashKey, index.rangeKey].filter(notNull);
        const indexed = pick(item, props);
        return Object.assign({}, indexed, table.getPrimaryKeys(item));
    };
    return {
        opType,
        hashKey,
        rangeKey,
        queryProp,
        index,
        itemToPosition,
        filterProps: usedProps,
        sortedByDB
    };
}
function runWithBackoffOnTableNotExists(fn, opts = {}) {
    opts = shallowClone(opts);
    opts.shouldTryAgain = err => err.name === 'ResourceNotFoundException';
    return runWithBackoffWhile(fn, opts);
}
const runWithBackoffWhile = (fn, opts) => __awaiter(this, void 0, void 0, function* () {
    const { initialDelay = 1000, maxAttempts = 10, maxTime = 60000, factor = 2, shouldTryAgain } = opts;
    const { maxDelay = maxTime / 2 } = opts;
    const start = Date.now();
    let millisToWait = initialDelay;
    let attempts = 0;
    while (Date.now() - start < maxTime && attempts++ < maxAttempts) {
        try {
            return yield fn();
        }
        catch (err) {
            if (!shouldTryAgain(err)) {
                throw err;
            }
            let haveTime = start + maxTime - Date.now() > 0;
            if (!haveTime)
                break;
            millisToWait = Math.min(maxDelay, millisToWait * factor);
            yield wait(millisToWait);
        }
    }
    throw new Error('timed out');
});
function wait(millis) {
    return new Promise(resolve => setTimeout(resolve, millis));
}
const waitTillActive = (table) => __awaiter(this, void 0, void 0, function* () {
    const { tableName } = table;
    const notReadyErr = new Error('not ready');
    yield runWithBackoffWhile(() => __awaiter(this, void 0, void 0, function* () {
        const { Table: { TableStatus } } = yield table.describeTable();
        switch (TableStatus) {
            case 'CREATING':
            case 'UPDATING':
                throw notReadyErr;
            case 'ACTIVE':
                return;
            case 'DELETING':
                throw new Error(`table "${tableName}" is being deleted`);
            default:
                const message = `table "${tableName}" has unknown TableStatus "${TableStatus}"`;
                debug(table.tableName, message);
                throw new Error(message);
        }
    }), {
        initialDelay: 1000,
        maxDelay: 10000,
        shouldTryAgain: err => err === notReadyErr
    });
});
function getModelPrimaryKeys(model) {
    return model.primaryKeys || constants_2.defaultPrimaryKeys;
}
function getResourcePrimaryKeys({ model, resource }) {
    const { hashKey, rangeKey } = getModelPrimaryKeys(model);
    const primaryKeys = {
        hashKey: resource[hashKey]
    };
    if (rangeKey) {
        primaryKeys[rangeKey] = resource[rangeKey];
    }
    return primaryKeys;
}
function getValues(obj) {
    return Object.keys(obj).map(key => obj[key]);
}
function notNull(val) {
    return !!val;
}
function minBy(arr, fn) {
    let min;
    let minVal;
    arr.forEach((item, i) => {
        if (typeof min === 'undefined') {
            min = item;
            minVal = fn(item, i);
        }
        else {
            const val = fn(item, i);
            if (val < minVal) {
                min = item;
                minVal = val;
            }
        }
    });
    return min;
}
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}
function defaultBackoffFunction(retryCount) {
    const delay = Math.pow(2, retryCount) * 500;
    return Math.min(jitter(delay, 0.1), 10000);
}
function jitter(val, percent) {
    // jitter by val * percent
    // eslint-disable-next-line no-mixed-operators
    return val * (1 + 2 * percent * Math.random() - percent);
}
const tableNameErrMsg = "Table/index names must be between 3 and 255 characters long, and may contain only the characters a-z, A-Z, 0-9, '_', '-', and '.'";
const tableNameRegex = /^[a-zA-Z0-9-_.]{3,}$/;
const validateTableName = (name) => {
    if (!tableNameRegex.test(name)) {
        throw new Error(`invalid table name "${name}", ${tableNameErrMsg}`);
    }
};
const expectedFilterTypeErrMsg = `filter.EQ.${[constants_1.TYPE]} is required`;
const getFilterType = (opts) => {
    const { filter } = opts;
    const EQ = filter && filter.EQ;
    const type = EQ && EQ[constants_1.TYPE];
    if (typeof type !== 'string') {
        throw new Error(expectedFilterTypeErrMsg);
    }
    return type;
};
const lazyDefine = (obj, keys, definer) => {
    keys.forEach(key => {
        let cachedValue;
        Object.defineProperty(obj, key, {
            get: () => {
                if (!cachedValue) {
                    cachedValue = definer(key);
                }
                return cachedValue;
            },
            set: value => {
                cachedValue = value;
            }
        });
    });
};
const getIndexForPrimaryKeys = ({ model }) => {
    return Object.assign({}, model.primaryKeys, { type: 'global', name: model.primaryKeys.hashKey, projection: {
            ProjectionType: 'KEYS_ONLY'
        } });
};
const propertyTypeToAttributeType = {
    string: 'S',
    number: 'N',
    date: 'N'
};
const getTableSchemaForModel = ({ models, model }) => {
    const primaryKeys = model.primaryKeys || constants_2.defaultPrimaryKeys;
    const TableName = getTableName({ model });
    const { hashKey, rangeKey } = primaryKeys;
    const hashKeyProp = model.properties[hashKey];
    const hashKeyType = propertyTypeToAttributeType[hashKeyProp.type];
    if (!hashKeyType)
        throw new Error(`unsupported hashKey property type ${hashKeyProp.type}`);
    const KeySchema = [
        {
            KeyType: 'HASH',
            AttributeName: hashKey
        }
    ];
    const AttributeDefinitions = [
        {
            AttributeType: hashKeyType,
            AttributeName: hashKey
        }
    ];
    if (rangeKey) {
        const rangeKeyProp = rangeKey && model.properties[rangeKey];
        const rangeKeyType = rangeKey && propertyTypeToAttributeType[rangeKeyProp.type];
        if (!rangeKeyType)
            throw new Error(`unsupported rangeKey property type ${rangeKeyProp.type}`);
        KeySchema.push({
            KeyType: 'RANGE',
            AttributeName: rangeKey
        });
        AttributeDefinitions.push({
            AttributeType: rangeKeyType,
            AttributeName: rangeKey
        });
    }
    return {
        TableName,
        AttributeDefinitions,
        KeySchema
        // GlobalSecondaryIndexes
    };
};
const getTableDefinitionForModel = ({ models, model }) => {
    const primaryKeys = model.primaryKeys || constants_2.defaultPrimaryKeys;
    return Object.assign({}, primaryKeys, { tableName: getTableName({ model }), timestamps: false, 
        // make this the reponsibility of the updating party
        // createdAt: false,
        // updatedAt: '_dateModified',
        schema: toJoi({ models, model }), indexes: model.primaryKeys ? [] : constants_2.defaultIndexes, validation: {
            allowUnknown: true
        } });
};
const defaultTableSchema = require('./default-schema');
const getDefaultTableSchema = ({ tableName }) => {
    return Object.assign({ TableName: tableName }, defaultTableSchema);
};
const getDefaultTableDefinition = ({ tableName }) => {
    return Object.assign({}, constants_2.defaultPrimaryKeys, { tableName, timestamps: false, 
        // make this the reponsibility of the updating party
        // createdAt: false,
        // updatedAt: '_dateModified',
        schema: metadataTypes, indexes: constants_2.defaultIndexes.map(toDynogelIndexDefinition), validation: {
            allowUnknown: true
        } });
};
const attributeTypeToJoi = {
    S: Joi.string(),
    N: Joi.number(),
    B: Joi.binary()
};
const tableDescriptionToJoi = (cloudformation) => {
    const { AttributeDefinitions } = cloudformation;
    return AttributeDefinitions.reduce((joi, def) => {
        joi[def.AttributeName] = attributeTypeToJoi[def.AttributeType];
        return joi;
    }, {});
};
const toDynogelTableDefinition = (cloudformation) => {
    const { TableName, KeySchema, GlobalSecondaryIndexes = [], AttributeDefinitions } = cloudformation;
    const hashKey = KeySchema.find(key => key.KeyType === 'HASH').AttributeName;
    const rangeKeyDef = KeySchema.find(key => key.KeyType === 'RANGE');
    const rangeKey = rangeKeyDef && rangeKeyDef.AttributeName;
    const indexes = GlobalSecondaryIndexes.map(toDynogelIndexDefinition);
    const schema = tableDescriptionToJoi(cloudformation);
    const def = {
        tableName: TableName,
        hashKey,
        schema,
        indexes,
        timestamps: false,
        createdAt: false,
        updatedAt: false,
        validation: {
            allowUnknown: true
        }
    };
    if (rangeKey) {
        def.rangeKey = rangeKey;
    }
    return def;
};
const toDynogelIndexDefinition = (cloudformation) => {
    const { KeySchema, Projection, ProvisionedThroughput, IndexName } = cloudformation;
    const hashKey = KeySchema.find(key => key.KeyType === 'HASH').AttributeName;
    const rangeKeyDef = KeySchema.find(key => key.KeyType === 'RANGE');
    return {
        hashKey,
        name: IndexName,
        type: 'global',
        rangeKey: rangeKeyDef && rangeKeyDef.AttributeName,
        projection: Projection
    };
};
const doesIndexProjectProperty = ({ table, index, property }) => {
    const { ProjectionType, NonKeyAttributes } = index.projection;
    if (ProjectionType === 'ALL') {
        return true;
    }
    if (ProjectionType === 'INCLUDE') {
        return NonKeyAttributes.includes(property);
    }
    return index.rangeKey === property || table.primaryKeyProps.includes(property);
};
const uniqueStrict = arr => {
    const map = new Map();
    const uniq = [];
    for (const item of arr) {
        if (!map.has(item)) {
            map.set(item, true);
            uniq.push(item);
        }
    }
    return uniq;
};
const utils = {
    fromResourceStub,
    sortResults,
    compare,
    promisify,
    debug,
    clone,
    shallowClone,
    extend,
    bindAll,
    deepEqual,
    pick,
    omit,
    toObject,
    getIndexes,
    getTableName,
    resultsToJson,
    getQueryInfo,
    runWithBackoffWhile,
    runWithBackoffOnTableNotExists,
    waitTillActive,
    getModelPrimaryKeys,
    getResourcePrimaryKeys,
    getValues,
    minBy,
    sha256,
    wait,
    defaultBackoffFunction,
    validateTableName,
    getFilterType,
    lazyDefine,
    levenshteinDistance,
    getIndexForPrimaryKeys,
    getTableDefinitionForModel,
    getDefaultTableDefinition,
    toDynogelTableDefinition,
    toDynogelIndexDefinition,
    doesIndexProjectProperty,
    getModelProperties,
    uniqueStrict,
    getDefaultTableSchema,
    getTableSchemaForModel
};
module.exports = utils;
//# sourceMappingURL=utils.js.map
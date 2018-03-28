"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const crypto = require("crypto");
const _ = require("lodash");
const bindAll = require("bindall");
exports.bindAll = bindAll;
const promisify = require("pify");
exports.promisify = promisify;
const levenshtein = require("fast-levenshtein");
const joi_1 = tslib_1.__importDefault(require("joi"));
const toJoi = require("@tradle/schema-joi");
const constants_1 = require("@tradle/constants");
const constants_2 = require("./constants");
const OPERATORS = require("./operators");
const debug = require('debug')(require('../package.json').name);
exports.debug = debug;
// const metadataTypes = toJoi({
//   model: BaseObjectModel
// })
// const defaultTableAttributes = toJoi({
//   models: {
//     [BaseObjectModel.id]: BaseObjectModel
//   },
//   model: {
//     properties: _.uniq(
//         defaultIndexPropertyNames
//         .concat(defaultHashKeyProperty)
//         .concat(defaultRangeKeyProperty)
//       )
//       .reduce((props, prop) => {
//         props[prop] = { type: 'string' }
//         return props
//       }, {})
//   }
// })
const levenshteinDistance = (a, b) => levenshtein.get(a, b);
exports.levenshteinDistance = levenshteinDistance;
function getTableName({ model, prefix = '', suffix = '' }) {
    const name = (model.id || model).replace(/[.]/g, '_');
    return prefix + name + suffix;
}
exports.getTableName = getTableName;
// function getIndexes (model) {
//   return defaultIndexes.slice()
// }
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
exports.sortResults = sortResults;
function compare(a, b, propertyName, asc) {
    const aVal = _.get(a, propertyName);
    const bVal = _.get(b, propertyName);
    if (aVal < bVal)
        return asc ? -1 : 1;
    if (aVal > bVal)
        return asc ? 1 : -1;
    return 0;
}
exports.compare = compare;
function toObject(arr) {
    const obj = {};
    for (let val of arr) {
        obj[val] = true;
    }
    return obj;
}
exports.toObject = toObject;
function fromResourceStub(props) {
    const [type, permalink, link] = props.id.split('_');
    return {
        [constants_1.TYPE]: type,
        link,
        permalink
    };
}
exports.fromResourceStub = fromResourceStub;
function resultsToJson(items) {
    // return items
    if (Array.isArray(items)) {
        return items.map(item => {
            return item.toJSON ? item.toJSON() : item;
        });
    }
    return items.toJSON ? items.toJSON() : items;
}
exports.resultsToJson = resultsToJson;
function getUsedProperties(filter) {
    const flat = flatten(filter);
    const props = flat.reduce((all, more) => {
        _.extend(all, more);
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
const getModelProperties = _.memoize(model => {
    return uniqueStrict(Object.keys(model.properties).concat(ObjectModelKeys));
}, model => model.id);
exports.getModelProperties = getModelProperties;
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
function getQueryInfo({ table, filter, orderBy }) {
    // orderBy is not counted, because for a 'query' op,
    // a value for the indexed prop must come from 'filter'
    const usedProps = getUsedProperties(filter);
    const { indexes, primaryKeys, hashKeyProps } = table;
    const { hashKey, rangeKey } = primaryKeys;
    const primaryKeysArr = _.values(primaryKeys);
    const indexedPropsMap = toObject(hashKeyProps);
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
        orderBy = Object.assign({}, orderBy, { property: table.resolveOrderBy({
                type: this.type,
                hashKey: queryProp,
                property: orderBy.property
            }) });
        if (orderBy.property === preferred.rangeKey) {
            sortedByDB = true;
        }
    }
    const itemToPosition = function itemToPosition(item) {
        item = table.withDerivedProperties(item);
        if (!item)
            throw new Error('expected database record');
        if (queryProp === hashKey || opType === 'scan') {
            return _.pick(item, primaryKeysArr);
        }
        const props = [index.hashKey, index.rangeKey].filter(notNull);
        const indexed = _.pick(item, props);
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
exports.getQueryInfo = getQueryInfo;
function runWithBackoffOnTableNotExists(fn, opts = {}) {
    opts = _.clone(opts);
    opts.shouldTryAgain = err => err.code === 'ResourceNotFoundException';
    return runWithBackoffWhile(fn, opts);
}
exports.runWithBackoffOnTableNotExists = runWithBackoffOnTableNotExists;
const runWithBackoffWhile = (fn, opts) => tslib_1.__awaiter(this, void 0, void 0, function* () {
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
exports.runWithBackoffWhile = runWithBackoffWhile;
function wait(millis) {
    return new Promise(resolve => setTimeout(resolve, millis));
}
exports.wait = wait;
const waitTillActive = (table) => tslib_1.__awaiter(this, void 0, void 0, function* () {
    const { tableName } = table;
    const notReadyErr = new Error('not ready');
    yield runWithBackoffWhile(() => tslib_1.__awaiter(this, void 0, void 0, function* () {
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
exports.waitTillActive = waitTillActive;
// function getModelPrimaryKeys (model) {
//   return model.primaryKeys || defaultPrimaryKeys
// }
// function getResourcePrimaryKeys ({ model, resource }) {
//   const { hashKey, rangeKey } = getModelPrimaryKeys(model)
//   const primaryKeys = {
//     hashKey: resource[hashKey]
//   }
//   if (rangeKey) {
//     primaryKeys[rangeKey] = resource[rangeKey]
//   }
//   return primaryKeys
// }
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
exports.minBy = minBy;
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}
exports.sha256 = sha256;
function defaultBackoffFunction(retryCount) {
    const delay = Math.pow(2, retryCount) * 500;
    return Math.min(jitter(delay, 0.1), 10000);
}
exports.defaultBackoffFunction = defaultBackoffFunction;
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
exports.validateTableName = validateTableName;
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
exports.getFilterType = getFilterType;
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
exports.lazyDefine = lazyDefine;
const getIndexForPrimaryKeys = ({ model }) => {
    return Object.assign({}, model.primaryKeys, { type: 'global', name: model.primaryKeys.hashKey, projection: {
            ProjectionType: 'KEYS_ONLY'
        } });
};
exports.getIndexForPrimaryKeys = getIndexForPrimaryKeys;
const getTableDefinitionForModel = ({ models, model }) => {
    const { primaryKeys } = model;
    return Object.assign({}, primaryKeys, { tableName: getTableName({ model }), timestamps: false, 
        // make this the reponsibility of the updating party
        // createdAt: false,
        // updatedAt: '_dateModified',
        schema: toJoi({ models, model }), indexes: [], validation: {
            allowUnknown: true
        } });
};
exports.getTableDefinitionForModel = getTableDefinitionForModel;
// const getDefaultTableDefinition = ({ tableName }: {
//   tableName:string
// }):IDynogelTableDefinition => {
//   return {
//     // values are prefixed with type
//     tableName,
//     timestamps: false,
//     // make this the reponsibility of the updating party
//     // createdAt: false,
//     // updatedAt: '_dateModified',
//     schema: defaultTableAttributes,
//     indexes: defaultIndexes,
//     validation: {
//       allowUnknown: true
//     }
//   }
// }
const cfToJoi = {
    N: joi_1.default.number(),
    S: joi_1.default.string()
};
const toDynogelTableDefinition = (cloudformation) => {
    const { TableName, KeySchema, GlobalSecondaryIndexes = [], AttributeDefinitions } = cloudformation;
    const hashKey = KeySchema.find(key => key.KeyType === 'HASH').AttributeName;
    const rangeKeyDef = KeySchema.find(key => key.KeyType === 'RANGE');
    const rangeKey = rangeKeyDef && rangeKeyDef.AttributeName;
    const indexes = GlobalSecondaryIndexes.map(toDynogelIndexDefinition);
    const schema = {};
    AttributeDefinitions.forEach(def => {
        schema[def.AttributeName] = cfToJoi[def.AttributeType];
    });
    return {
        tableName: TableName,
        hashKey,
        rangeKey,
        schema,
        indexes,
        timestamps: false,
        createdAt: false,
        updatedAt: false,
        validation: {
            allowUnknown: true
        }
    };
};
exports.toDynogelTableDefinition = toDynogelTableDefinition;
const toDynogelIndexDefinition = (cloudformation) => {
    const { KeySchema, Projection, ProvisionedThroughput, IndexName } = cloudformation;
    const hashKey = KeySchema.find(key => key.KeyType === 'HASH').AttributeName;
    const rangeKeyDef = KeySchema.find(key => key.KeyType === 'RANGE');
    return {
        hashKey,
        name: IndexName,
        type: 'global',
        rangeKey: rangeKeyDef && rangeKeyDef.AttributeName,
        projection: _.pick(Projection, ['ProjectionType', 'NonKeyAttributes'])
    };
};
exports.toDynogelIndexDefinition = toDynogelIndexDefinition;
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
exports.doesIndexProjectProperty = doesIndexProjectProperty;
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
exports.uniqueStrict = uniqueStrict;
// const cachify = (get:Function, cache:Cache) => {
//   const cachified = async (...args) => {
//     const str = stableStringify(args)
//     const cached = cache.get(str)
//     if (cached) {
//       // refetch on error
//       return cached.catch(err => cachified(...args))
//     }
//     const result = get(...args)
//     result.catch(err => cache.del(str))
//     cache.set(str, result)
//     return result
//   }
//   return cachified
// }
exports.hookUp = (fn, event) => function (...args) {
    return tslib_1.__awaiter(this, void 0, void 0, function* () {
        yield this.hooks.fire(`${event}:pre`, { args });
        const result = yield fn.apply(this, args);
        yield this.hooks.fire(`${event}:post`, { args, result });
        return result;
    });
};
//# sourceMappingURL=utils.js.map
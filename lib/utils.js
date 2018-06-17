"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const crypto = require("crypto");
const _ = require("lodash");
const bindAll = require("bindall");
exports.bindAll = bindAll;
const promisify = require("pify");
exports.promisify = promisify;
const traverse = require("traverse");
const levenshtein = require("fast-levenshtein");
const AWS = require("aws-sdk");
const joi_1 = tslib_1.__importDefault(require("joi"));
const array_sort_1 = tslib_1.__importDefault(require("array-sort"));
const dynamodb_expressions_1 = require("@aws/dynamodb-expressions");
const toJoi = require("@tradle/schema-joi");
const constants_1 = require("@tradle/constants");
const validate_model_1 = tslib_1.__importDefault(require("@tradle/validate-model"));
const defaults = tslib_1.__importStar(require("./defaults"));
const constants_2 = require("./constants");
const OPERATORS = require("./operators");
const { getNestedProperties } = validate_model_1.default.utils;
const { marshall, unmarshall } = AWS.DynamoDB.Converter;
const fixUnmarshallItem = item => traverse(item).map(function (value) {
    // unwrap Set instances
    if (value &&
        value.values &&
        value.constructor !== Object) {
        this.update(value.values);
    }
});
exports.levenshteinDistance = (a, b) => levenshtein.get(a, b);
exports.cleanName = str => str.replace(/[.]/g, '_');
exports.getTableName = ({ model, prefix = '', suffix = '' }) => {
    const name = exports.cleanName(model.id || model);
    return prefix + name + suffix;
};
// function getIndexes (model) {
//   return defaultIndexes.slice()
// }
exports.sortResults = ({ results, orderBy, defaultOrderBy }) => {
    // make sure both are initialized
    orderBy = orderBy || defaultOrderBy;
    defaultOrderBy = defaultOrderBy || orderBy;
    if (!orderBy)
        return results;
    const { property, desc } = orderBy;
    if (property === defaultOrderBy.property) {
        return array_sort_1.default(results, property, { reverse: desc });
    }
    return array_sort_1.default(results, [property, defaultOrderBy.property], { reverse: desc });
};
exports.compare = (a, b, propertyName) => {
    const aVal = _.get(a, propertyName);
    const bVal = _.get(b, propertyName);
    if (aVal < bVal)
        return -1;
    if (aVal > bVal)
        return 1;
    return 0;
};
exports.toObject = (arr) => {
    const obj = {};
    for (let val of arr) {
        obj[val] = true;
    }
    return obj;
};
exports.fromResourceStub = (props) => {
    const [type, permalink, link] = props.id.split('_');
    return {
        [constants_1.TYPE]: type,
        link,
        permalink
    };
};
exports.resultsToJson = (items) => {
    // return items
    if (Array.isArray(items)) {
        return items.map(item => {
            return item.toJSON ? item.toJSON() : item;
        });
    }
    return items.toJSON ? items.toJSON() : items;
};
exports.getUsedProperties = (filter) => {
    const flat = exports.flatten(filter);
    const props = flat.reduce((all, more) => {
        _.extend(all, more);
        return all;
    }, {});
    return Object.keys(props);
};
/**
 * flattens nested filter
 *
 * has no semantic meaning, this is just to be able to check
 * which props are being filtered against
 */
exports.flatten = (filter) => {
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
};
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
exports.getModelProperties = _.memoize(model => {
    return exports.uniqueStrict(Object.keys(model.properties).concat(ObjectModelKeys));
}, model => model.id);
exports.getMissingProperties = ({ resource, model, opts }) => {
    let { select } = opts;
    if (!select) {
        select = exports.getModelProperties(model);
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
exports.getPreferredQueryProperty = ({ table, properties }) => {
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
    const index = exports.getIndexForProperty({ table, property });
    return {
        index,
        property,
        rangeKey: index && index.rangeKey
    };
};
exports.getIndexForProperty = ({ table, property }) => {
    return table.indexes.find(({ hashKey }) => hashKey === property);
};
exports.getQueryInfo = ({ table, filter, orderBy, type }) => {
    // orderBy is not counted, because for a 'query' op,
    // a value for the indexed prop must come from 'filter'
    filter = _.cloneDeep(filter);
    const usedProps = exports.getUsedProperties(filter);
    const { indexes, primaryKeys, primaryKeyProps, hashKeyProps } = table;
    const { hashKey, rangeKey } = primaryKeys;
    const indexedPropsMap = exports.toObject(hashKeyProps);
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
    let defaultOrderBy;
    if (opType === 'query') {
        // supported key condition operators:
        // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions
        const preferred = exports.getPreferredQueryProperty({ table, properties: usedIndexedProps });
        queryProp = preferred.property;
        index = preferred.index;
        defaultOrderBy = { property: preferred.rangeKey };
        let resolvedOrderBy;
        if (orderBy) {
            resolvedOrderBy = table.resolveOrderBy({
                type,
                hashKey: queryProp,
                property: orderBy.property,
                item: EQ
            });
            defaultOrderBy.desc = orderBy.desc;
            orderBy = Object.assign({}, orderBy, { property: resolvedOrderBy.property });
        }
        else {
            orderBy = defaultOrderBy;
        }
        if (orderBy.property === preferred.rangeKey) {
            sortedByDB = true;
        }
        else {
            sortedByDB = hasAllKeyProps({ def: index || table, item: EQ });
        }
        if (resolvedOrderBy && !resolvedOrderBy.full && resolvedOrderBy.prefix) {
            if (!filter.STARTS_WITH) {
                filter.STARTS_WITH = {};
            }
            const iRangeKey = index.rangeKey;
            const { STARTS_WITH } = filter;
            if (iRangeKey && !STARTS_WITH[iRangeKey]) {
                STARTS_WITH[iRangeKey] = exports.renderTemplate(resolvedOrderBy.prefix, EQ);
            }
        }
    }
    else {
        orderBy = {};
        if (rangeKey) {
            orderBy.property = rangeKey;
        }
    }
    const itemToPosition = function itemToPosition(item) {
        item = Object.assign({ [constants_1.TYPE]: type }, item);
        item = table.withDerivedProperties(item);
        if (!item)
            throw new Error('expected database record');
        const primaryKeyValues = table.getPrimaryKeys(item);
        if (queryProp === hashKey || opType === 'scan') {
            return primaryKeyValues;
        }
        const props = [index.hashKey, index.rangeKey].filter(notNull);
        const indexed = _.pick(item, props);
        return Object.assign({}, indexed, primaryKeyValues);
    };
    return {
        opType,
        hashKey,
        rangeKey,
        queryProp,
        index,
        itemToPosition,
        filterProps: usedProps,
        sortedByDB,
        orderBy,
        defaultOrderBy,
        expandedFilter: filter,
    };
};
function runWithBackoffOnTableNotExists(fn, opts = {}) {
    opts = _.clone(opts);
    opts.shouldTryAgain = err => err.code === 'ResourceNotFoundException';
    return runWithBackoffWhile(fn, opts);
}
exports.runWithBackoffOnTableNotExists = runWithBackoffOnTableNotExists;
const runWithBackoffWhile = async (fn, opts) => {
    const { initialDelay = 1000, maxAttempts = 10, maxTime = 60000, factor = 2, shouldTryAgain } = opts;
    const { maxDelay = maxTime / 2 } = opts;
    const start = Date.now();
    let millisToWait = initialDelay;
    let attempts = 0;
    while (Date.now() - start < maxTime && attempts++ < maxAttempts) {
        try {
            return await fn();
        }
        catch (err) {
            if (!shouldTryAgain(err)) {
                throw err;
            }
            let haveTime = start + maxTime - Date.now() > 0;
            if (!haveTime)
                break;
            millisToWait = Math.min(maxDelay, millisToWait * factor);
            await wait(millisToWait);
        }
    }
    throw new Error('timed out');
};
exports.runWithBackoffWhile = runWithBackoffWhile;
function wait(millis) {
    return new Promise(resolve => setTimeout(resolve, millis));
}
exports.wait = wait;
const waitTillActive = async (table) => {
    const { tableName } = table;
    const notReadyErr = new Error('not ready');
    await runWithBackoffWhile(async () => {
        const { Table: { TableStatus } } = await table.describeTable();
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
                table.logger.debug(table.tableName, message);
                throw new Error(message);
        }
    }, {
        initialDelay: 1000,
        maxDelay: 10000,
        shouldTryAgain: err => err === notReadyErr
    });
};
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
exports.lazyDefine = (obj, keys, definer) => {
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
exports.getTableDefinitionForModel = ({ models, model }) => {
    const { primaryKeys } = model;
    return Object.assign({}, exports.normalizeIndexedProperty(primaryKeys), { tableName: exports.getTableName({ model }), timestamps: false, 
        // make this the reponsibility of the updating party
        // createdAt: false,
        // updatedAt: '_dateModified',
        schema: toJoi({ models, model }), indexes: [], validation: {
            allowUnknown: true
        } });
};
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
exports.toDynogelTableDefinition = (cloudformation) => {
    const { TableName, KeySchema, GlobalSecondaryIndexes = [], AttributeDefinitions } = cloudformation;
    const hashKey = KeySchema.find(key => key.KeyType === 'HASH').AttributeName;
    const rangeKeyDef = KeySchema.find(key => key.KeyType === 'RANGE');
    const rangeKey = rangeKeyDef && rangeKeyDef.AttributeName;
    const indexes = GlobalSecondaryIndexes.map(exports.toDynogelIndexDefinition);
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
exports.toDynogelIndexDefinition = (cloudformation) => {
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
exports.doesIndexProjectProperty = ({ table, index, property }) => {
    const { ProjectionType, NonKeyAttributes } = index.projection;
    if (ProjectionType === 'ALL' ||
        index.hashKey === property ||
        index.rangeKey === property ||
        table.primaryKeyProps.includes(property)) {
        return true;
    }
    if (ProjectionType === 'INCLUDE') {
        return NonKeyAttributes.includes(property);
    }
    return false;
};
exports.uniqueStrict = arr => {
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
exports.hookUp = (fn, event) => async function (...args) {
    await this.hooks.fire(`${event}:pre`, { args });
    const result = await fn.apply(this, args);
    await this.hooks.fire(`${event}:post`, { args, result });
    return result;
};
exports.getTemplateStringVariables = (str) => {
    const match = str.match(/\{([^}]+)\}/g);
    if (match) {
        return match.map(part => part.slice(1, part.length - 1));
    }
    return [];
};
exports.getTemplateStringValues = exports.getTemplateStringVariables;
exports.checkRenderable = (template, item, noConstants) => {
    const paths = exports.getTemplateStringVariables(template);
    const ret = { full: false, prefix: '' };
    if (!paths.length && noConstants) {
        return ret;
    }
    const unrenderablePathIdx = paths.findIndex(path => typeof _.get(item, path) === 'undefined');
    ret.full = unrenderablePathIdx === -1;
    if (ret.full) {
        ret.prefix = template;
    }
    else {
        const idx = template.indexOf('{' + paths[unrenderablePathIdx] + '}');
        ret.prefix = ret.full ? template : template.slice(0, idx);
    }
    return ret;
};
const TEMPLATE_SETTINGS = /{([\s\S]+?)}/g;
exports.renderTemplate = (str, data) => {
    const render = _.template(str, {
        interpolate: TEMPLATE_SETTINGS
    });
    data = exports.encodeTemplateValues(data);
    return render(data);
};
exports.renderTemplatePrefix = (str, data) => {
    const vars = exports.getTemplateStringVariables(str).slice();
    const renderable = [];
    while (vars.length && typeof _.get(data, vars[0])) {
    }
};
/**
 * This is done to be able to parse the template values out
 * and match them to property names in post-query/scan processing
 */
exports.encodeTemplateValues = data => traverse(data).map(function (val) {
    if (this.circular)
        throw new Error('unexpected circular reference');
    if (this.isLeaf) {
        this.update('{' + encodeURIComponent(val) + '}');
    }
}, {});
// const encodeTemplateValues = data => _.transform(data, (encoded, value, key) => {
//   if (value == null) return
//   if (typeof value === 'object') {
//     encoded[key] = encodeValues(value)
//   } else {
//     encoded[key] = '{' + encodeURIComponent(value) + '}'
//   }
// }, {})
exports.normalizeIndexedProperty = (property) => {
    if (typeof property === 'string') {
        return { hashKey: property };
    }
    constants_2.PRIMARY_KEYS_PROPS.forEach(key => {
        if (typeof property[key] !== 'string') {
            throw new Error(`expected string "${key}"`);
        }
    });
    return _.pick(property, constants_2.PRIMARY_KEYS_PROPS);
};
exports.normalizeIndexedPropertyTemplateSchema = (property) => {
    if (typeof property === 'string' || Array.isArray(property)) {
        return {
            hashKey: { template: exports.getKeyTemplateString(property) }
        };
    }
    const { hashKey, rangeKey } = property;
    if (!hashKey)
        throw new Error('expected "hashKey"');
    const ret = {};
    for (const key of constants_2.PRIMARY_KEYS_PROPS) {
        const val = property[key];
        if (!val)
            continue;
        if (val.template) {
            ret[key] = val;
        }
        else {
            ret[key] = {
                template: exports.getKeyTemplateString(val)
            };
        }
    }
    return ret;
};
exports.getKeyTemplateString = (val) => {
    if (typeof val === 'string') {
        if (exports.getTemplateStringVariables(val).length) {
            return val;
        }
        return `{${val}}`;
    }
    if (Array.isArray(val)) {
        return val.map(exports.getKeyTemplateString).join('');
    }
    throw new Error(`unable to parse template string`);
};
// export const getKeyTemplateFromProperty = (property:string):KeyTemplate => ({ template: `{{${property}}}` })
exports.pickNonNull = (obj, props) => [].concat(props).reduce((picked, prop) => {
    if (obj[prop] != null) {
        picked[prop] = obj[prop];
    }
    return picked;
}, {});
// export const ensureRangeKey = (index: IndexedProperty):IndexedProperty => ({
//   ...index,
//   rangeKey: index.rangeKey || RANGE_KEY_PLACEHOLDER_VALUE
// })
exports.getExpandedProperties = _.memoize(({ models, model }) => (Object.assign({}, model.properties, OriginalBaseObjectModel.properties, getNestedProperties({ models, model }))), ({ model }) => model.id);
exports.getIndexesForModel = ({ table, model }) => {
    return (model.indexes || defaults.indexes).map(index => exports.normalizeIndexedPropertyTemplateSchema(index));
};
exports.getPrimaryKeysForModel = ({ table, model }) => {
    return exports.normalizeIndexedPropertyTemplateSchema(model.primaryKeys || defaults.primaryKeys);
};
exports.resolveOrderBy = ({ table, type, hashKey, property, item = {} }) => {
    const model = table.models[type];
    if (!model)
        return;
    const index = table.indexed.find(index => index.hashKey === hashKey);
    const indexes = table.getKeyTemplatesForModel(model);
    const indexedProp = indexes[table.indexed.indexOf(index)];
    if (!(indexedProp && indexedProp.rangeKey))
        return;
    const rangeKeyDerivesFromProp = exports.checkRenderable(indexedProp.rangeKey.template, Object.assign({ [property]: 'placeholder' }, item));
    if (rangeKeyDerivesFromProp.full || rangeKeyDerivesFromProp.prefix) {
        return Object.assign({ property: index.rangeKey }, exports.checkRenderable(indexedProp.rangeKey.template, item));
    }
};
const encodeHashKeyTemplate = (type, value) => type + value;
const decodeHashKeyTemplate = (value) => {
    const idx = value.indexOf('{');
    if (idx === -1) {
        return { type: value };
    }
    return {
        type: value.slice(0, idx),
        value: value.slice(idx)
    };
};
exports.deriveProps = ({ table, item, isRead, noConstants }) => {
    if (!table.derivedProps.length) {
        return {};
    }
    // expand '.' props
    item = expandNestedProps(item);
    let rType = item[constants_1.TYPE];
    if (!rType) {
        const { hashKey } = table.indexed.find(i => i.hashKey in item);
        if (!hashKey) {
            throw new Error('unable to deduce resource type');
        }
        rType = decodeHashKeyTemplate(item[hashKey]).type;
    }
    const model = table.models[rType];
    const indexes = table.getKeyTemplatesForModel(model);
    const renderable = _.chain(indexes)
        .map((templates, i) => {
        const { hashKey, rangeKey } = table.indexed[i];
        const ret = [{
                property: hashKey,
                template: encodeHashKeyTemplate(rType, templates.hashKey.template)
            }];
        if (rangeKey) {
            ret.push({
                property: rangeKey,
                template: templates.rangeKey ? templates.rangeKey.template : constants_2.RANGE_KEY_PLACEHOLDER_VALUE
            });
        }
        return ret;
    })
        .flatten()
        // only render the keys for which we have all the variables
        .filter(({ template }) => exports.checkRenderable(template, item, noConstants).full)
        .value();
    return renderable.reduce((inputs, { property, template, sort }) => {
        const val = exports.renderTemplate(template, item);
        if (val.length) {
            // empty strings not allowed!
            inputs[property] = val;
        }
        return inputs;
    }, {});
};
exports.parseDerivedProps = ({ table, model, resource }) => {
    const { models } = table;
    const templates = _.chain(table.getKeyTemplatesForModel(model))
        .flatMap(({ hashKey, rangeKey }) => {
        return [
            Object.assign({}, hashKey, { type: 'hash' }),
            rangeKey && Object.assign({}, rangeKey, { type: 'range' })
        ];
    })
        .filter(_.identity)
        // .filter(info => /^[{]{2}[^}]+[}]{2}$/.test(info.template))
        .value();
    const derived = _.pick(resource, table.derivedProps);
    const properties = exports.getExpandedProperties({ models, model });
    return _.transform(derived, (parsed, value, prop) => {
        const info = templates.find(({ key }) => key === prop);
        if (!info)
            return;
        const { key, template, type } = info;
        let propVal = value;
        if (type === 'hash') {
            propVal = decodeHashKeyTemplate(propVal).value;
            if (typeof propVal === 'undefined')
                return;
        }
        const propPaths = exports.getTemplateStringVariables(template);
        const propVals = exports.getTemplateStringVariables(propVal).map(decodeURIComponent);
        const pathToVal = _.zipObject(propPaths, propVals);
        Object.keys(pathToVal).forEach(propPath => {
            const propMeta = properties[propPath];
            if (!propMeta)
                return;
            let val = pathToVal[propPath];
            const pType = propMeta.type;
            // complex props not supported at the moment
            if (pType === 'array' || pType === 'object')
                return;
            if (pType === 'number' || pType === 'date') {
                val = parseInt(val, 10);
            }
            else if (pType === 'boolean') {
                val = val === 'true' || val === '1';
            }
            // use _.set as propPath may be a nested prop, e.g. blah._permalink
            _.set(parsed, propPath, val);
        });
    }, {
        [constants_1.TYPE]: model.id
    });
};
const expandNestedProps = obj => {
    const expanded = {};
    for (let key in obj) {
        _.set(expanded, key, obj[key]);
    }
    return expanded;
};
exports.getTableKeys = (def) => {
    const { hashKey, rangeKey } = def;
    return [hashKey, rangeKey]
        .concat(_.flatten(def.indexes.map(def => [def.hashKey, def.rangeKey])))
        .filter(_.identity);
};
exports.toAttributePath = (path) => {
    const parts = [].concat(path).map(name => ({
        type: 'AttributeName',
        name
    }));
    return new dynamodb_expressions_1.AttributePath(parts);
};
exports.marshallDBItem = item => marshall(item);
exports.unmarshallDBItem = item => fixUnmarshallItem(unmarshall(item));
exports.createUpdateOptionsFromDiff = diff => {
    const atts = new dynamodb_expressions_1.ExpressionAttributes();
    const updateExp = new dynamodb_expressions_1.UpdateExpression();
    diff.forEach(({ op, path, value }) => {
        const attPath = exports.toAttributePath(path);
        if (op === 'remove') {
            updateExp.remove(attPath);
        }
        else {
            updateExp.set(attPath, value);
        }
    });
    const updateExpStr = updateExp.serialize(atts);
    return {
        UpdateExpression: updateExpStr,
        ExpressionAttributeNames: atts.names,
        ExpressionAttributeValues: exports.unmarshallDBItem(atts.values)
    };
};
exports.getDecisionProps = ({ filter, select }) => {
    const props = (select || []).concat(exports.getUsedProperties(filter || {}));
    return exports.uniqueStrict(props);
};
const hasAllKeyProps = ({ def, item }) => {
    const keyProps = [def.hashKey];
    if (def.rangeKey)
        keyProps.push(def.rangeKey);
    if (keyProps.every(keyProp => item[keyProp])) {
        return true;
    }
    return false;
};
//# sourceMappingURL=utils.js.map
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const events_1 = require("events");
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const dynogels_1 = tslib_1.__importDefault(require("dynogels"));
const constants_1 = require("@tradle/constants");
const validate_resource_1 = tslib_1.__importDefault(require("@tradle/validate-resource"));
const event_hooks_1 = tslib_1.__importDefault(require("event-hooks"));
const pify_1 = tslib_1.__importDefault(require("pify"));
const constants_2 = require("./constants");
const errors_1 = tslib_1.__importDefault(require("./errors"));
const utils = tslib_1.__importStar(require("./utils"));
const { wait, defaultBackoffFunction, sha256, validateTableName, getFilterType, getTableName, getTableDefinitionForModel, getModelProperties, hookUp, resultsToJson, normalizeIndexedPropertyTemplateSchema, normalizeIndexedProperty, toDynogelTableDefinition, pickNonNull } = utils;
const defaults = tslib_1.__importStar(require("./defaults"));
const minify_1 = tslib_1.__importDefault(require("./minify"));
const search_1 = require("./search");
const constants_3 = require("./constants");
const defaultOpts = {
    maxItemSize: Infinity,
    allowScan: true,
    validate: false,
    defaultReadOptions: {
        consistentRead: false
    }
};
const defaultBackoffOpts = {
    backoff: defaultBackoffFunction,
    maxTries: 6
};
const HOOKABLE = [
    'put',
    'update',
    'merge',
    'get',
    'del',
    'batchPut',
    'find',
    'findOne',
    'create',
    'destroy'
];
class Table extends events_1.EventEmitter {
    constructor(opts) {
        super();
        this.getKeyTemplate = (model, key) => {
            const keyIdx = this.keyProps.indexOf(key);
            return lodash_1.default.flatMap(this.getKeyTemplatesForModel(model), ({ hashKey, rangeKey }) => {
                return rangeKey ? [hashKey, rangeKey] : hashKey;
            })[keyIdx];
        };
        this.getKeyTemplatesForModel = (model) => {
            if (!model) {
                throw new Error('expected "model"');
            }
            const raw = [
                this.getPrimaryKeysForModel(model),
                ...this.getIndexesForModel(model)
            ]
                .map(normalizeIndexedPropertyTemplateSchema);
            if (raw.length > this.indexed.length) {
                console.warn(`more key templates than indexes for model: ${model.id}!`);
            }
            return raw.slice(0, this.indexed.length).map((indexedProp, i) => (Object.assign({}, indexedProp, { hashKey: Object.assign({}, indexedProp.hashKey, { key: this.indexed[i].hashKey }), rangeKey: indexedProp.rangeKey && Object.assign({}, indexedProp.rangeKey, { key: this.indexed[i].rangeKey }) })));
        };
        this.getIndexesForModel = (model) => this._getIndexesForModel({ table: this, model });
        this.getIndexesForType = (type) => this._getIndexesForModel({
            table: this,
            model: this._getModel(type)
        });
        this.getPrimaryKeysForModel = (model) => this._getPrimaryKeysForModel({ table: this, model });
        this.getPrimaryKeysForType = (type) => this._getPrimaryKeysForModel({
            table: this,
            model: this._getModel(type)
        });
        this.hook = (method, handler) => this.hooks.hook(method, handler);
        this.storeResourcesForModels = (models) => lodash_1.default.each(models, model => this.storeResourcesForModel({ model }));
        this.storeResourcesForModel = ({ model }) => {
            if (this.exclusive) {
                if (model.id === this.model.id) {
                    this.modelsStored[model.id] = model;
                    return;
                }
                throw new Error(`this table is exclusive to type: ${model.id}`);
            }
            if (!this.modelsStored[model.id]) {
                this.logger.silly(`will store resources of model ${model.id}`);
            }
            this.modelsStored[model.id] = model;
            if (!this.models[model.id]) {
                this.models[model.id] = model;
            }
        };
        this.get = async (query, opts = {}) => {
            this.logger.silly(`get() ${JSON.stringify(query)}`);
            const expandedQuery = this.toDBFormat(query);
            const keysObj = this.getPrimaryKeys(expandedQuery);
            let result;
            if (this._hasAllPrimaryKeys(keysObj)) {
                const keys = lodash_1.default.values(keysObj);
                result = await this.table.get(...keys, Object.assign({}, this.opts.defaultReadOptions, opts));
            }
            else {
                // try to fall back to index
                //
                // hmm...rethink this? dynamodb indexes apparently don't enforce uniqueness
                // so this get() isn't really a get, it's more of a findOne
                const index = this.indexes.find(index => this._hasAllKeys(expandedQuery, index));
                if (!index) {
                    throw new Error('expected primary keys or keys for an indexed property');
                }
                result = await this.findOne({
                    orderBy: {
                        property: index.rangeKey
                    },
                    filter: {
                        EQ: query
                    }
                });
            }
            if (!result) {
                throw new errors_1.default.NotFound(`query: ${JSON.stringify(query)}`);
            }
            const resource = this.fromDBFormat(result);
            const cut = resource[constants_2.minifiedFlag] || [];
            if (this.objects && cut.length) {
                return this.objects.get(resource._link);
            }
            return this._exportResource(resource, opts);
        };
        this.del = async (query, opts = { throwOnNotFound: false }) => {
            this._ensureWritable();
            query = this.toDBFormat(query);
            const keys = lodash_1.default.values(this.getPrimaryKeys(query));
            try {
                const result = await this.table.destroy(...keys, opts);
                return result && this._exportResource(result, opts);
            }
            catch (err) {
                errors_1.default.ignoreNotFound(err);
                if (opts.throwOnNotFound) {
                    throw new errors_1.default.NotFound(err.message);
                }
            }
        };
        this._exportResource = (resource, opts = {}) => {
            resource = this.fromDBFormat(resource);
            if (!opts.keepDerivedProps) {
                resource = this.omitDerivedProperties(resource);
            }
            return resource;
        };
        this.batchPut = async (resources, backoffOpts = defaultBackoffOpts) => {
            this._ensureWritable();
            resources = resources.map(this.withDerivedProperties);
            resources.forEach(this._ensureHasPrimaryKeys);
            resources.forEach(this._validateResource);
            const minified = resources.map(this._minify);
            // let mins = minified.map(({ min }) => this.toDBFormat(min))
            let mins = minified.map(({ min }) => min);
            let batch;
            while (mins.length) {
                batch = mins.slice(0, constants_2.batchWriteLimit);
                mins = mins.slice(constants_2.batchWriteLimit);
                await this._batchPut(batch, backoffOpts);
                this.logger.silly(`batchPut ${batch.length} items successfully`);
            }
            return resources;
        };
        this.put = async (resource, opts) => {
            this.logger.silly(`put() ${resource[constants_1.TYPE]}`);
            this._validateResource(resource);
            return await this._write('create', resource, opts);
        };
        this.update = async (resource, opts) => {
            this.logger.silly(`update() ${resource[constants_1.TYPE]}`);
            return await this._write('update', resource, opts);
        };
        this.merge = async (resource, opts) => {
            return await this.update(resource, opts);
        };
        this.find = async (_opts) => {
            const opts = Object.assign({}, this.findOpts, lodash_1.default.cloneDeep(_opts), { table: this });
            // ensure type is set on filter
            getFilterType(opts);
            this.logger.silly(`find() ${opts.filter.EQ[constants_1.TYPE]}`);
            const op = new search_1.Search(opts);
            await this.hooks.fire('pre:find:validate', op);
            let results;
            try {
                results = await op.exec();
            }
            catch (err) {
                if (err.code === 'ValidationException') {
                    this.logger.error('request failed validation', err.request);
                }
                throw err;
            }
            this.logger.silly(`find returned ${results.items.length} results`);
            results.items = results.items.map(resource => this._exportResource(resource, opts));
            return results;
        };
        this.findOne = async (opts) => {
            opts = Object.assign({}, opts, { limit: 1 });
            const { items = [] } = await this.find(opts);
            if (!items.length) {
                throw new errors_1.default.NotFound(`query: ${JSON.stringify(opts)}`);
            }
            return items[0];
        };
        this.matchOne = async (type, props) => {
            return await this.findOne({
                filter: {
                    EQ: Object.assign({ _t: type }, props)
                }
            });
        };
        this.search = (opts) => this.find(opts);
        this.list = async (type, opts = {}) => this.find(lodash_1.default.merge({
            filter: {
                EQ: {
                    [constants_1.TYPE]: type
                }
            }
        }, opts));
        this.getPrefix = function (type) {
            if (typeof type === 'object') {
                type = type[constants_1.TYPE];
            }
            if (!this._prefix[type]) {
                this._prefix[type] = getTableName({ model: this.models[type] });
            }
            return this._prefix[type];
        };
        this.create = async () => {
            this.logger.info('creating table');
            try {
                await this.table.createTable();
            }
            catch (err) {
                errors_1.default.ignore(err, { code: 'ResourceInUseException' });
            }
            this.logger.silly('created table');
        };
        this.destroy = async (opts = { throwOnNotFound: false }) => {
            this.logger.info('destroying table');
            try {
                await this.table.deleteTable();
            }
            catch (err) {
                errors_1.default.ignoreNotFound(err);
                if (opts.throwOnNotFound) {
                    throw new errors_1.default.NotFound(err.message);
                }
            }
            this.logger.silly('destroyed table');
        };
        this._initTable = () => {
            const table = dynogels_1.default.define(this.name, lodash_1.default.omit(this.tableDefinition, ['defaultReadOptions', 'primaryKeys']));
            this.table = pify_1.default(table, {
                include: [
                    'createTable',
                    'deleteTable',
                    'describeTable',
                    'create',
                    'get',
                    'update',
                    'destroy'
                ]
            });
        };
        this.deriveProps = (opts) => {
            const { item } = opts;
            const derived = this._deriveProps(Object.assign({ table: this, isRead: false }, opts));
            return lodash_1.default.omitBy(derived, (value, prop) => prop in item || value == null);
        };
        this.toDBFormat = resource => this.withDerivedProperties(resource);
        // public toDBFormat = (resource) => {
        //   if (this.hashKey === typeAndPermalinkProperty) {
        //     resource = {
        //       ...resource,
        //       [typeAndPermalinkProperty]: this.calcTypeAndPermalinkProperty(resource)
        //     }
        //   }
        //   return this.prefixProperties(resource)
        // }
        this.fromDBFormat = resultsToJson;
        // return this._exportResource(resource)
        // return this.unprefixProperties(resource)
        // public prefixKey = ({ type, key }: { type:string, key:string }):string => {
        //   return DONT_PREFIX.includes(key)
        //     ? key
        //     : prefixString(key, this.getPrefix(type))
        // }
        // public prefixProperties = function (resource) {
        //   return this.prefixPropertiesForType(resource[TYPE], resource)
        // }
        // public prefixPropertiesForType = function (type:string, properties:any) {
        //   return this.exclusive
        //     ? properties
        //     : prefixKeys(properties, this.getPrefix(type), DONT_PREFIX)
        // }
        // public unprefixProperties = function (resource) {
        //   return this.unprefixPropertiesForType(resource[TYPE], resource)
        // }
        // public unprefixPropertiesForType = function (type:string, resource:any) {
        //   return this.exclusive
        //     ? resource
        //     : unprefixKeys(resource, this.getPrefix(type), DONT_PREFIX)
        // }
        // public prefixPropertyNamesForType = function (type: string, props: string[]) {
        //   return this.exclusive ? props : props.map(prop => prefixString(prop, this.getPrefix(type)))
        // }
        this._write = async (method, resource, options = {}) => {
            this._ensureWritable();
            const type = resource[constants_1.TYPE] || (this.exclusive && this.model.id);
            const model = this.modelsStored[type];
            if (!model)
                throw new Error(`model not found: ${type}`);
            resource = this.toDBFormat(resource);
            this._ensureHasPrimaryKeys(resource);
            if (method === 'create') {
                const minified = this._minify(resource);
                resource = minified.min;
            }
            else if (options && options.diff) {
                const { diff } = options;
                validateDiff(diff);
                options = Object.assign({}, utils.createUpdateOptionsFromDiff(diff), lodash_1.default.omit(options, ['diff']));
                resource = this.getPrimaryKeys(resource);
            }
            let result;
            try {
                result = await this.table[method](resource, options);
            }
            catch (err) {
                errors_1.default.rethrow(err, 'developer');
                if (err.code === 'ValidationException') {
                    this.logger.error('request failed validation', err.request);
                }
                err.input = { item: resource, options };
                throw err;
            }
            const primaryKeys = this.getPrimaryKeys(resource);
            this.logger.silly(`"${method}" ${JSON.stringify(primaryKeys)} successfully`);
            return result && this._exportResource(result, options);
        };
        this._validateResource = (resource) => {
            const { models, modelsStored } = this;
            const type = resource[constants_1.TYPE];
            const model = models[type];
            if (!model) {
                throw new Error(`missing model ${type}`);
            }
            if (this.opts.validate) {
                validate_resource_1.default({ models, model, resource });
            }
        };
        this._batchPut = async (resources, backoffOpts) => {
            this.logger.silly(`batchPut() ${resources.length} items`);
            const params = {
                RequestItems: {
                    [this.name]: resources.map(Item => ({
                        PutRequest: { Item }
                    }))
                }
            };
            if (!params.ReturnConsumedCapacity) {
                params.ReturnConsumedCapacity = 'TOTAL';
            }
            const { backoff, maxTries } = backoffOpts;
            const { docClient } = this.opts;
            let tries = 0;
            let start = Date.now();
            let time = 0;
            let failed;
            while (tries < maxTries) {
                this.logger.silly('attempting batchWrite');
                let result = await docClient.batchWrite(params).promise();
                failed = result.UnprocessedItems;
                if (!(failed && Object.keys(failed).length))
                    return;
                this.logger.debug(`batchPut partially failed, retrying`);
                params.RequestItems = failed;
                await wait(backoff(tries++));
            }
            const err = new Error('batch put failed');
            err.failed = failed;
            err.attempts = tries;
            throw err;
        };
        this.getPrimaryKeys = resource => this.getKeys(resource, this.primaryKeys);
        this.getKeys = (resource, schema) => {
            return lodash_1.default.pick(resource, getKeyProps(schema));
        };
        // private getPrimaryKeys = (resource) => {
        //   const have = _.pick(resource, this.primaryKeyProps)
        //   if (this.hashKey === typeAndPermalinkProperty && !have[typeAndPermalinkProperty]) {
        //     have[typeAndPermalinkProperty] = this.calcTypeAndPermalinkProperty(resource)
        //   }
        //   return have
        // }
        // public calcTypeAndPermalinkProperty = (resource):string => {
        //   if (resource[typeAndPermalinkProperty]) return resource[typeAndPermalinkProperty]
        //   if (!(resource._permalink && resource[TYPE])) {
        //     throw new Error(`missing one of required props: _permalink, ${TYPE}`)
        //   }
        //   return prefixString(resource._permalink, resource[TYPE])
        // }
        this.addDerivedProperties = (item, isRead) => lodash_1.default.extend(item, this.deriveProps({ item, isRead }));
        this.withDerivedProperties = item => lodash_1.default.extend({}, item, this.deriveProps({ item }));
        this.omitDerivedProperties = item => lodash_1.default.omit(item, this.derivedProps);
        this.resolveOrderBy = (opts) => {
            return this._resolveOrderBy(Object.assign({ table: this }, opts));
        };
        this.reindex = async ({ model, batchSize = 50, findOpts = {} }) => {
            const table = this;
            const { indexes } = model;
            if (indexes) {
                const hasType = indexes
                    .map(normalizeIndexedProperty)
                    .some(i => i.hashKey === '_t');
                if (!hasType)
                    throw new errors_1.default.InvalidInput('model is not indexed by type');
            }
            let checkpoint;
            let updated = 0;
            let unchanged = 0;
            const limit = batchSize;
            while (true) {
                let { items, endPosition } = await table.find(lodash_1.default.merge({
                    limit,
                    filter: {
                        EQ: {
                            _t: model.id
                        }
                    },
                    checkpoint
                }, findOpts));
                if (!items.length)
                    break;
                checkpoint = endPosition;
                let changed = items.filter(item => table.haveIndexedPropsChanged(item));
                unchanged += (items.length - changed.length);
                // force re-index
                if (changed.length) {
                    await table.batchPut(changed);
                    updated += changed.length;
                }
                if (items.length < limit)
                    break;
            }
            return {
                updated,
                unchanged
            };
        };
        this.haveIndexedPropsChanged = item => {
            const recalced = this.withDerivedProperties(this.omitDerivedProperties(item));
            const before = lodash_1.default.pick(item, this.keyProps);
            const after = lodash_1.default.pick(recalced, this.keyProps);
            return !lodash_1.default.isEqual(before, after);
        };
        this._ensureWritable = () => {
            if (this.readOnly) {
                throw new Error('this table is read-only!');
            }
        };
        this._ensureHasPrimaryKeys = (resource) => {
            if (!this._hasAllPrimaryKeys(resource)) {
                throw new Error('expected values for all primary keys');
            }
        };
        this._hasAllPrimaryKeys = obj => this._hasAllKeys(obj, this.primaryKeys);
        this._hasAllKeys = (obj, schema) => {
            return lodash_1.default.size(this.getKeys(obj, schema)) === lodash_1.default.size(getKeyProps(schema));
        };
        this._minify = (item) => {
            if (this._shouldMinify(item)) {
                return minify_1.default({
                    table: this,
                    item,
                    maxSize: this.opts.maxItemSize
                });
            }
            return {
                min: item,
                diff: {}
            };
        };
        this._getModel = (type) => {
            const model = this.models[type];
            if (!model)
                throw new errors_1.default.InvalidInput(`missing model for type: ${type}`);
            return model;
        };
        const table = this;
        this.opts = Object.assign({}, defaultOpts, opts);
        const { models, model, modelsStored = {}, objects, exclusive, allowScan, readOnly, defaultReadOptions, tableDefinition, derivedProps = [], deriveProps = utils.deriveProps, resolveOrderBy = utils.resolveOrderBy, getIndexesForModel = utils.getIndexesForModel, getPrimaryKeysForModel = utils.getPrimaryKeysForModel, parseDerivedProps = utils.parseDerivedProps, shouldMinify = lodash_1.default.stubTrue, logger = defaults.logger, } = this.opts;
        if (!models)
            throw new Error('expected "models"');
        if (exclusive && !model) {
            throw new Error('expected "model" when "exclusive" is true');
        }
        this.logger = logger;
        // @ts-ignore
        this.tableDefinition = tableDefinition.TableName ? toDynogelTableDefinition(tableDefinition) : tableDefinition;
        validateTableName(this.tableDefinition.tableName);
        this.name = this.tableDefinition.tableName;
        this.models = lodash_1.default.clone(models);
        this.objects = objects;
        this.modelsStored = modelsStored;
        this.readOnly = readOnly;
        this.exclusive = exclusive;
        this.model = model;
        this._prefix = {};
        this.primaryKeys = pickNonNull(this.tableDefinition, constants_3.PRIMARY_KEYS_PROPS);
        this.indexes = this.tableDefinition.indexes || [];
        this.indexed = this.indexes.slice();
        this.indexed.unshift(Object.assign({ type: 'global', name: '_', projection: {
                ProjectionType: 'ALL'
            } }, this.primaryKeys));
        this._deriveProps = deriveProps;
        this.derivedProps = derivedProps;
        this.parseDerivedProps = parseDerivedProps;
        this._resolveOrderBy = resolveOrderBy;
        this._getIndexesForModel = getIndexesForModel;
        this._getPrimaryKeysForModel = getPrimaryKeysForModel;
        this._shouldMinify = shouldMinify;
        this.findOpts = {
            allowScan,
            consistentRead: defaultReadOptions.consistentRead
        };
        this.primaryKeyProps = lodash_1.default.values(this.primaryKeys);
        this.hashKeyProps = lodash_1.default.uniq(this.indexed.map(i => i.hashKey));
        this.keyProps = lodash_1.default.uniq(lodash_1.default.flatMap(this.indexed, index => lodash_1.default.values(lodash_1.default.pick(index, constants_3.PRIMARY_KEYS_PROPS))));
        if (exclusive) {
            this.storeResourcesForModel({ model });
        }
        this._initTable();
        this.on('def:update', () => this.table = null);
        this.logger.silly('initialized');
        this.hooks = event_hooks_1.default();
        HOOKABLE.forEach(method => {
            this[method] = hookUp(this[method].bind(this), method);
        });
    }
    get hashKey() {
        return this.primaryKeys.hashKey;
    }
    get rangeKey() {
        return this.primaryKeys.rangeKey;
    }
}
exports.Table = Table;
exports.createTable = (opts) => new Table(opts);
const getKeyProps = (schema) => lodash_1.default.values(pickNonNull(schema, constants_3.PRIMARY_KEYS_PROPS));
const DIFF_OPS = ['add', 'remove', 'replace'];
const validateDiff = diff => {
    if (!Array.isArray(diff)) {
        throw new errors_1.default.InvalidInput(`expected diff to be array of diff items`);
    }
    diff.forEach(validateDiffItem);
};
const validateDiffItem = ({ op, path, value }) => {
    if (!DIFF_OPS.includes(op)) {
        throw new errors_1.default.InvalidInput(`invalid diff op: ${op}`);
    }
    if (!(Array.isArray(path) && path.every(sub => typeof sub === 'string'))) {
        throw new errors_1.default.InvalidInput(`invalid diff path, expected string array: ${JSON.stringify(path)}`);
    }
};
//# sourceMappingURL=table.js.map
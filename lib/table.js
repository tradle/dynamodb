"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const events_1 = require("events");
const lodash_1 = tslib_1.__importDefault(require("lodash"));
const dynogels_1 = tslib_1.__importDefault(require("dynogels"));
const constants_1 = require("@tradle/constants");
const validate_resource_1 = tslib_1.__importDefault(require("@tradle/validate-resource"));
const errors_1 = tslib_1.__importDefault(require("@tradle/errors"));
const event_hooks_1 = tslib_1.__importDefault(require("event-hooks"));
const pify_1 = tslib_1.__importDefault(require("pify"));
const constants_2 = require("./constants");
const utils_1 = require("./utils");
const minify_1 = tslib_1.__importDefault(require("./minify"));
const errors_2 = require("./errors");
const filter_dynamodb_1 = tslib_1.__importDefault(require("./filter-dynamodb"));
const object_model_1 = tslib_1.__importDefault(require("./object-model"));
const constants_3 = require("./constants");
// TODO: add this prop to tradle.Object
const DONT_PREFIX = Object.keys(object_model_1.default.properties);
const defaultOpts = {
    maxItemSize: Infinity,
    requireSigned: true,
    forbidScan: false,
    validate: false,
    defaultReadOptions: {
        consistentRead: false
    }
};
const defaultBackoffOpts = {
    backoff: utils_1.defaultBackoffFunction,
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
const defaultResolveOrderBy = (opts) => opts.property;
class Table extends events_1.EventEmitter {
    constructor(opts) {
        super();
        this.hook = (method, handler) => this.hooks.hook(method, handler);
        this.addModel = ({ model }) => {
            if (this.exclusive) {
                if (model.id === this.model.id) {
                    this.modelsStored[model.id] = model;
                    return;
                }
                throw new Error(`this table is exclusive to type: ${model.id}`);
            }
            this.modelsStored[model.id] = model;
            this._debug(`will store resources of model ${model.id}`);
        };
        this.get = (query, opts = {}) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this._debug(`get() ${JSON.stringify(query)}`);
            const expandedQuery = this.toDBFormat(query);
            const keysObj = this.getPrimaryKeys(expandedQuery);
            let result;
            if (this._hasAllPrimaryKeys(keysObj)) {
                const keys = lodash_1.default.values(keysObj);
                result = yield this.table.get(...keys, Object.assign({}, this.opts.defaultReadOptions, opts));
            }
            else {
                debugger;
                throw new Error('expected all primaryKeys');
                // result = await this.findOne({
                //   orderBy: {
                //     property: this.rangeKey,
                //     desc: false
                //   },
                //   filter: {
                //     EQ: query
                //   }
                // })
            }
            if (!result) {
                throw new errors_2.NotFound(`query: ${JSON.stringify(query)}`);
            }
            const resource = this.fromDBFormat(result);
            const cut = resource[constants_2.minifiedFlag] || [];
            if (this.objects && cut.length) {
                return this.objects.get(resource._link);
            }
            return resource;
        });
        this.del = (query, opts = {}) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this._ensureWritable();
            query = this.toDBFormat(query);
            const keys = lodash_1.default.values(this.getPrimaryKeys(query));
            return yield this.table.destroy(...keys, opts);
        });
        this._exportResource = resource => this.omitDerivedProperties(resource);
        this.batchPut = (resources, backoffOpts = defaultBackoffOpts) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this._ensureWritable();
            const { maxItemSize } = this.opts;
            resources.forEach(this._validateResource);
            resources = resources.map(this.withDerivedProperties);
            const minified = resources.map(item => minify_1.default({
                table: this,
                item,
                maxSize: maxItemSize
            }));
            // let mins = minified.map(({ min }) => this.toDBFormat(min))
            let mins = minified.map(({ min }) => min);
            let batch;
            while (mins.length) {
                batch = mins.slice(0, constants_2.batchWriteLimit);
                mins = mins.slice(constants_2.batchWriteLimit);
                yield this._batchPut(batch, backoffOpts);
                this._debug(`batchPut ${batch.length} items successfully`);
            }
            return resources;
        });
        this.put = (resource, opts) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this._debug(`put() ${resource[constants_1.TYPE]}`);
            return yield this._write('create', resource, opts);
        });
        this.update = (resource, opts) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this._debug(`update() ${resource[constants_1.TYPE]}`);
            return yield this._write('update', resource, opts);
        });
        this.merge = (resource, opts) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            return yield this.update(resource, opts);
        });
        this.find = (opts) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            opts = Object.assign({}, this.findOpts, lodash_1.default.cloneDeep(opts), { table: this });
            // ensure type is set on filter
            utils_1.getFilterType(opts);
            this._debug(`find() ${opts.filter.EQ[constants_1.TYPE]}`);
            const results = yield filter_dynamodb_1.default(opts);
            this._debug(`find returned ${results.items.length} results`);
            results.items = results.items.map(resource => this._exportResource(resource));
            return results;
        });
        this.findOne = (opts) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            opts = Object.assign({}, opts, { limit: 1 });
            const { items = [] } = yield this.find(opts);
            if (!items.length) {
                throw new errors_2.NotFound(`query: ${JSON.stringify(opts)}`);
            }
            return items[0];
        });
        this.search = opts => this.find(opts);
        this.getPrefix = function (type) {
            if (typeof type === 'object') {
                type = type[constants_1.TYPE];
            }
            if (!this._prefix[type]) {
                this._prefix[type] = utils_1.getTableName({ model: this.models[type] });
            }
            return this._prefix[type];
        };
        this.create = () => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this._debug('create() table');
            try {
                yield this.table.createTable();
            }
            catch (err) {
                errors_1.default.ignore(err, { code: 'ResourceInUseException' });
            }
            this._debug('created table');
        });
        this.destroy = () => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this._debug('destroy() table');
            try {
                yield this.table.deleteTable();
            }
            catch (err) {
                errors_1.default.ignore(err, { code: 'ResourceNotFoundException' });
            }
            this._debug('destroyed table');
        });
        this._debug = (...args) => {
            args.unshift(this.name);
            utils_1.debug(...args);
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
        this.deriveProperties = (resource, forRead = false) => {
            return lodash_1.default.omitBy(this._deriveProperties(resource, forRead), (value, prop) => {
                return prop in resource || value == null;
            });
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
        this.fromDBFormat = (resource) => {
            if (typeof resource.toJSON === 'function') {
                resource = resource.toJSON();
            }
            return this._exportResource(resource);
            // return this.unprefixProperties(resource)
        };
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
        this._write = (method, resource, options) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this._ensureWritable();
            const type = resource[constants_1.TYPE] || (this.exclusive && this.model.id);
            const model = this.modelsStored[type];
            if (!model)
                throw new Error(`model not found: ${type}`);
            resource = this.toDBFormat(resource);
            if (method === 'update' && !this._hasAllPrimaryKeys(resource)) {
                throw new Error('update requires values for all primary keys');
            }
            if (method === 'create') {
                const minified = minify_1.default({
                    table: this,
                    item: resource,
                    maxSize: this.opts.maxItemSize
                });
                resource = minified.min;
            }
            let result;
            try {
                result = yield this.table[method](resource, options);
            }
            catch (err) {
                errors_1.default.rethrow(err, 'developer');
                err.input = { item: resource, options };
                throw err;
            }
            const primaryKeys = this.getPrimaryKeys(resource);
            this._debug(`"${method}" ${JSON.stringify(primaryKeys)} successfully`);
            return result;
        });
        this._validateResource = (resource) => {
            const self = this;
            const { models, requireSigned } = this.opts;
            const { modelsStored } = this;
            const type = resource[constants_1.TYPE];
            const model = models[type];
            if (!model) {
                throw new Error(`missing model ${type}`);
            }
            // const missingKeyProp = this.primaryKeyProps.find(prop => resource[prop] == null)
            // if (missingKeyProp) {
            //   throw new Error(`expected: ${missingKeyProp}`)
            // }
            if (requireSigned && !resource[constants_1.SIG]) {
                const keys = JSON.stringify(this.getPrimaryKeys(resource));
                throw new Error(`expected resource to be signed: ${keys}`);
            }
            validate_resource_1.default({ models, model, resource });
        };
        this._batchPut = (resources, backoffOpts) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this._debug(`batchPut() ${resources.length} items`);
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
                this._debug('attempting batchWrite');
                let result = yield docClient.batchWrite(params).promise();
                failed = result.UnprocessedItems;
                if (!(failed && Object.keys(failed).length))
                    return;
                this._debug(`batchPut partially failed, retrying`);
                params.RequestItems = failed;
                yield utils_1.wait(backoff(tries++));
            }
            const err = new Error('batch put failed');
            err.failed = failed;
            err.attempts = tries;
            throw err;
        });
        this.getPrimaryKeys = resource => lodash_1.default.pick(this.withDerivedProperties(resource), this.primaryKeyProps);
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
        this.addDerivedProperties = (resource, forRead) => lodash_1.default.extend(resource, this.deriveProperties(resource, forRead));
        this.withDerivedProperties = resource => lodash_1.default.extend({}, resource, this.deriveProperties(resource));
        this.omitDerivedProperties = resource => lodash_1.default.omit(resource, this.derivedProperties);
        this.resolveOrderBy = (opts) => {
            return this._resolveOrderBy(opts) || opts.property;
        };
        this._ensureWritable = () => {
            if (this.readOnly) {
                throw new Error('this table is read-only!');
            }
        };
        this._hasAllPrimaryKeys = obj => lodash_1.default.size(this.getPrimaryKeys(obj)) === this.primaryKeyProps.length;
        this.opts = Object.assign({}, defaultOpts, opts);
        const { models, model, objects, exclusive, requireSigned, forbidScan, readOnly, defaultReadOptions, tableDefinition, deriveProperties = lodash_1.default.stubObject, derivedProperties = [], resolveOrderBy } = this.opts;
        if (!models)
            throw new Error('expected "models"');
        if (exclusive && !model) {
            throw new Error('expected "model" when "exclusive" is true');
        }
        // @ts-ignore
        this.tableDefinition = tableDefinition.TableName ? toDynogelTableDefinition(tableDefinition) : tableDefinition;
        utils_1.validateTableName(this.tableDefinition.tableName);
        this.name = this.tableDefinition.tableName;
        this.models = models;
        this.objects = objects;
        this.modelsStored = {};
        this.readOnly = readOnly;
        this.exclusive = exclusive;
        this.model = model;
        this._prefix = {};
        this.primaryKeys = lodash_1.default.pick(this.tableDefinition, constants_3.PRIMARY_KEYS_PROPS);
        this.indexes = this.tableDefinition.indexes;
        // this.indexes = this.tableDefinition.indexes.concat([{
        //   type: 'global',
        //   name: '_',
        //   projection: {
        //     ProjectionType: 'ALL'
        //   },
        //   ...this.primaryKeys
        // }])
        this._deriveProperties = deriveProperties;
        this.derivedProperties = derivedProperties;
        this._resolveOrderBy = resolveOrderBy || defaultResolveOrderBy;
        this.findOpts = {
            models,
            forbidScan,
            primaryKeys: this.primaryKeys,
            consistentRead: defaultReadOptions.consistentRead
        };
        this.primaryKeyProps = lodash_1.default.values(this.primaryKeys);
        this.hashKeyProps = lodash_1.default.uniq([this.hashKey].concat(this.indexes.map(index => index.hashKey)));
        this.keyProps = lodash_1.default.uniq(this.primaryKeyProps.concat(lodash_1.default.flatMap(this.indexes, index => lodash_1.default.values(lodash_1.default.pick(index, constants_3.PRIMARY_KEYS_PROPS)))));
        if (exclusive) {
            this.addModel({ model });
        }
        this._initTable();
        this.on('def:update', () => this.table = null);
        this._debug('initialized');
        this.hooks = event_hooks_1.default();
        HOOKABLE.forEach(method => {
            this[method] = utils_1.hookUp(this[method].bind(this), method);
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
//# sourceMappingURL=table.js.map
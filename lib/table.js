"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const events_1 = require("events");
const dynogels = require("dynogels");
const constants_1 = require("@tradle/constants");
const validateResource = require("@tradle/validate-resource");
const promisify = require("pify");
const constants_2 = require("./constants");
const utils_1 = require("./utils");
const minify_1 = require("./minify");
const errors_1 = require("./errors");
const filter_dynamodb_1 = require("./filter-dynamodb");
const prefix_1 = require("./prefix");
const object_model_1 = require("./object-model");
// TODO: add this prop to tradle.Object
const DONT_PREFIX = Object.keys(object_model_1.default.properties);
const defaultOpts = {
    maxItemSize: Infinity,
    requireSigned: true,
    bodyInObjects: true,
    forbidScan: false,
    validate: false,
    defaultReadOptions: {}
};
const defaultBackoffOpts = {
    backoff: utils_1.defaultBackoffFunction,
    maxTries: 6
};
class Table extends events_1.EventEmitter {
    constructor(name, opts) {
        super();
        this.inflate = (resource) => __awaiter(this, void 0, void 0, function* () {
            this._debug(`inflating ${resource[constants_1.TYPE]} from object store`);
            const link = resource._link;
            const full = yield this.objects.get(link);
            resource = Object.assign({}, resource, full);
            delete resource[constants_2.minifiedFlag];
            return resource;
        });
        this.addModel = ({ model, indexes }) => {
            if (this.exclusive) {
                if (model.id === this.model.id)
                    return;
                throw new Error(`this table is exclusive to type: ${model.id}`);
            }
            if (!this.modelsStored[model.id]) {
                this.modelsStored[model.id] = model;
                this._debug(`will store resources of model ${model.id}`);
            }
            if (!(indexes && indexes.length))
                return;
            if (this.opts.tableDefinition) {
                throw new Error(`can't add indexes to table with pre-defined "tableDefinition"`);
            }
            this.indexes = this.indexes.concat(indexes.map(index => {
                return Object.assign({}, index, { hashKey: this.prefixKey({
                        type: model.id,
                        key: index.hashKey
                    }), rangeKey: index.rangeKey && this.prefixKey({
                        type: model.id,
                        key: index.rangeKey
                    }) });
            }));
            this.tableDefinition.indexes = this.indexes;
            this._defineTable();
        };
        this.get = (query, opts = {}) => __awaiter(this, void 0, void 0, function* () {
            this._debug(`get() ${JSON.stringify(query)}`);
            query = this.toDBFormat(query);
            const keys = utils_1.getValues(this.getPrimaryKeys(query));
            const result = yield this.table.get(...keys, Object.assign({}, this.opts.defaultReadOptions, opts));
            if (!result) {
                throw new errors_1.NotFound(`query: ${JSON.stringify(query)}`);
            }
            const resource = yield this._maybeInflate(this.fromDBFormat(result.toJSON()));
            return this._exportResource(resource);
        });
        this.latest = (query, opts = {}) => __awaiter(this, void 0, void 0, function* () {
            if (this.hashKey === constants_2.typeAndPermalinkProperty) {
                return this.get(query, opts);
            }
            throw new Error(`only supported when hashKey is ${constants_2.typeAndPermalinkProperty}`);
        });
        this.del = (query, opts = {}) => __awaiter(this, void 0, void 0, function* () {
            this._ensureWritable();
            query = this.toDBFormat(query);
            const keys = utils_1.getValues(this.getPrimaryKeys(query));
            const result = yield this.table.destroy(...keys, opts);
        });
        this._exportResource = resource => utils_1.omit(resource, constants_2.typeAndPermalinkProperty);
        this.batchPut = (resources, backoffOpts = defaultBackoffOpts) => __awaiter(this, void 0, void 0, function* () {
            this._ensureWritable();
            const { maxItemSize } = this.opts;
            resources.forEach(this._validateResource);
            const minified = resources.map(item => minify_1.default({
                table: this,
                item,
                maxSize: maxItemSize
            }));
            let mins = minified.map(({ min }) => this.toDBFormat(min));
            let batch;
            while (mins.length) {
                batch = mins.slice(0, constants_2.batchWriteLimit);
                mins = mins.slice(constants_2.batchWriteLimit);
                yield this._batchPut(batch, backoffOpts);
                this._debug(`batchPut ${batch.length} items successfully`);
            }
            return resources;
        });
        this.put = (resource) => __awaiter(this, void 0, void 0, function* () {
            this._debug(`put() ${resource[constants_1.TYPE]}`);
            yield this._write('create', resource);
        });
        this.update = (resource) => __awaiter(this, void 0, void 0, function* () {
            this._debug(`update() ${resource[constants_1.TYPE]}`);
            yield this._write('update', resource);
        });
        this.merge = (resource) => __awaiter(this, void 0, void 0, function* () {
            yield this.update(resource);
        });
        this.find = (opts) => __awaiter(this, void 0, void 0, function* () {
            opts = Object.assign({}, this.findOpts, utils_1.clone(opts), { table: this });
            // ensure type is set on filter
            utils_1.getFilterType(opts);
            this._debug(`find() ${opts.filter.EQ[constants_1.TYPE]}`);
            const results = yield filter_dynamodb_1.default(opts);
            this._debug(`find returned ${results.items.length} results`);
            results.items = yield Promise.all(results.items.map(resource => {
                return this._maybeInflate(resource, opts);
            }));
            results.items = results.items.map(resource => this._exportResource(resource));
            return results;
        });
        this.search = (...args) => this.find(...args);
        this.getPrefix = function (type) {
            if (typeof type === 'object') {
                type = type[constants_1.TYPE];
            }
            if (!this._prefix[type]) {
                this._prefix[type] = utils_1.getTableName({ model: this.models[type] });
            }
            return this._prefix[type];
        };
        this.create = () => __awaiter(this, void 0, void 0, function* () {
            this._debug('create() table');
            try {
                yield this.table.createTable();
            }
            catch (err) {
                if (err.code === 'ResourceInUseException') {
                    this._debug('table already exists');
                }
                else {
                    throw err;
                }
            }
            this._debug('created table');
        });
        this.destroy = () => __awaiter(this, void 0, void 0, function* () {
            this._debug('destroy() table');
            try {
                yield this.table.deleteTable();
            }
            catch (err) {
                if (err.code === 'ResourceNotFoundException') {
                    this._debug('table does not exist');
                }
                else {
                    throw err;
                }
            }
            this._debug('destroyed table');
        });
        this._debug = (...args) => {
            args.unshift(this.name);
            utils_1.debug(...args);
        };
        this._defineTable = () => {
            if (!this.tableDefinition) {
                this._debug('using default definition for table');
                if (this.exclusive) {
                    const { models, model } = this;
                    this.tableDefinition = utils_1.getTableDefinitionForModel({ models, model });
                }
                else {
                    this.tableDefinition = utils_1.getDefaultTableDefinition({
                        tableName: this.name
                    });
                }
            }
            const table = dynogels.define(this.name, this.tableDefinition);
            this.table = promisify(table, {
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
            ['scan', 'query'].forEach(op => {
                this[op] = (...args) => {
                    const builder = table[op](...args);
                    builder.exec = this._wrapDBOperation(builder.exec.bind(builder));
                    return builder;
                };
            });
        };
        this.toDBFormat = (resource) => {
            if (this.hashKey === constants_2.typeAndPermalinkProperty) {
                resource = Object.assign({}, resource, { [constants_2.typeAndPermalinkProperty]: this.calcTypeAndPermalinkProperty(resource) });
            }
            return this.prefixProperties(resource);
        };
        this.fromDBFormat = (resource) => {
            return this.unprefixProperties(resource);
        };
        this.prefixKey = ({ type, key }) => {
            return DONT_PREFIX.includes(key)
                ? key
                : prefix_1.prefixString(key, this.getPrefix(type));
        };
        this.prefixProperties = function (resource) {
            return this.prefixPropertiesForType(resource[constants_1.TYPE], resource);
        };
        this.prefixPropertiesForType = function (type, properties) {
            return this.exclusive
                ? properties
                : prefix_1.prefixKeys(properties, this.getPrefix(type), DONT_PREFIX);
        };
        this.unprefixProperties = function (resource) {
            return this.unprefixPropertiesForType(resource[constants_1.TYPE], resource);
        };
        this.unprefixPropertiesForType = function (type, resource) {
            return this.exclusive
                ? resource
                : prefix_1.unprefixKeys(resource, this.getPrefix(type), DONT_PREFIX);
        };
        this._wrapDBOperation = (fn) => {
            const promisified = (...args) => __awaiter(this, void 0, void 0, function* () {
                const result = yield promisify(fn)(...args);
                if (!result)
                    return result;
                const { Item, Items } = result;
                if (Item) {
                    result.Item = Item.toJSON();
                    result.Item = this.fromDBFormat(result.Item);
                    yield this._maybeInflate(result.Item);
                }
                else if (Items) {
                    result.Items = Items
                        .map(Item => Item.toJSON())
                        .map(item => this.fromDBFormat(item));
                    yield Promise.all(result.Items.map(Item => this._maybeInflate(Item)));
                }
                return result;
            });
            return function (...args) {
                const callback = args.pop();
                Promise.resolve(promisified(...args))
                    .catch(callback)
                    .then(result => callback(null, result));
            };
        };
        this._maybeInflate = (resource, options = {}) => __awaiter(this, void 0, void 0, function* () {
            const { force, select } = options;
            const cut = resource[constants_2.minifiedFlag];
            if (force || (cut && cut.length)) {
                if (select) {
                    const needsInflate = cut.some(prop => select.includes(prop));
                    if (!needsInflate)
                        return resource;
                }
                resource = yield this.inflate(resource);
            }
            return resource;
        });
        this._write = (method, resource) => __awaiter(this, void 0, void 0, function* () {
            this._ensureWritable();
            const type = resource[constants_1.TYPE] || (this.exclusive && this.model.id);
            const model = this.modelsStored[type];
            if (!model)
                throw new Error(`model not found: ${type}`);
            let options;
            let current;
            if (this.hashKey === constants_2.typeAndPermalinkProperty) {
                options = {
                    ConditionExpression: 'attribute_not_exists(#tpermalink) OR #link = :link OR #time < :time',
                    ExpressionAttributeNames: {
                        '#time': '_time',
                        '#tpermalink': constants_2.typeAndPermalinkProperty,
                        '#link': '_link',
                    },
                    ExpressionAttributeValues: {
                        ':time': resource._time,
                        ':link': resource._link
                    }
                };
            }
            const { min, diff } = minify_1.default({
                table: this,
                item: resource,
                maxSize: this.opts.maxItemSize
            });
            const formatted = this.toDBFormat(min);
            const result = yield this.table[method](formatted, options);
            const primaryKeys = this.getPrimaryKeys(formatted);
            this._debug(`"${method}" ${JSON.stringify(primaryKeys)} successfully`);
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
            validateResource({ models, model, resource });
        };
        this._batchPut = (resources, backoffOpts) => __awaiter(this, void 0, void 0, function* () {
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
        this.getPrimaryKeys = (resource) => {
            const have = utils_1.pick(resource, this.primaryKeyProps);
            if (this.hashKey === constants_2.typeAndPermalinkProperty && !have._tpermalink) {
                have._tpermalink = this.calcTypeAndPermalinkProperty(resource);
            }
            return have;
        };
        this.calcTypeAndPermalinkProperty = (resource) => {
            if (resource._tpermalink)
                return resource._tpermalink;
            if (!(resource._permalink && resource[constants_1.TYPE])) {
                throw new Error(`missing one of required props: _permalink, ${constants_1.TYPE}`);
            }
            return prefix_1.prefixString(resource._permalink, resource[constants_1.TYPE]);
        };
        this._ensureWritable = () => {
            if (this.readOnly) {
                throw new Error('this table is read-only!');
            }
        };
        utils_1.validateTableName(name);
        this.opts = Object.assign({}, defaultOpts, opts);
        const { models, model, objects, exclusive, primaryKeys, requireSigned, forbidScan, readOnly, bodyInObjects, defaultReadOptions = {}, indexes, tableDefinition } = this.opts;
        if (!models)
            throw new Error('expected "models"');
        if (bodyInObjects && !objects)
            throw new Error('expected "objects"');
        if (exclusive && !model) {
            throw new Error('expected "model" when "exclusive" is true');
        }
        this.name = name;
        this.models = models;
        this.objects = objects;
        this.modelsStored = {};
        this.readOnly = readOnly;
        this.exclusive = exclusive;
        this.model = model;
        this._prefix = {};
        if (exclusive) {
            this.modelsStored[model.id] = model;
            this.primaryKeys = primaryKeys || model.primaryKeys;
        }
        else {
            this.primaryKeys = constants_2.defaultPrimaryKeys;
        }
        this.findOpts = utils_1.pick(opts, [
            'models',
            'forbidScan',
            'bodyInObjects'
        ]);
        if (defaultReadOptions.consistentRead) {
            this.findOpts.consistentRead = true;
        }
        this.findOpts.primaryKeys = this.primaryKeys;
        this.primaryKeyProps = utils_1.getValues(this.primaryKeys);
        if (tableDefinition) {
            if (indexes)
                throw new Error('expected "tableDefinition" or "indexes" but not both');
            this.tableDefinition = tableDefinition;
            this.indexes = tableDefinition.indexes;
        }
        else {
            // easier to think of everything as indexes
            // even the main table schema
            this.indexes = indexes || constants_2.defaultIndexes.slice();
            // {
            //   ...this.primaryKeys,
            //   name: this.primaryKeys.hashKey,
            //   type: 'global',
            //   projection: {
            //     ProjectionType: 'ALL'
            //   }
            // }
        }
        // invalidate cached table
        if (exclusive) {
            this.addModel({ model });
        }
        this._defineTable();
        this.on('def:update', () => this.table = null);
        this._debug('initialized');
    }
    get hashKey() {
        return this.primaryKeys.hashKey;
    }
    get rangeKey() {
        return this.primaryKeys.rangeKey;
    }
}
exports.default = Table;
exports.createTable = (name, opts) => {
    if (typeof name === 'object') {
        opts = name;
        return new Table(opts.tableDefinition.tableName, opts);
    }
    new Table(name, opts);
};
//# sourceMappingURL=table.js.map
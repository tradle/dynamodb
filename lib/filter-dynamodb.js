"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const _ = require("lodash");
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
const OPERATORS = require("./operators");
const comparators_1 = require("./comparators");
const filter_memory_1 = require("./filter-memory");
const constants_2 = require("./constants");
class FilterOp {
    constructor(opts) {
        this._debug = (...args) => {
            args.unshift(`search:${this.opType}`);
            utils_1.debug(...args);
        };
        this.exec = () => tslib_1.__awaiter(this, void 0, void 0, function* () {
            this._debug(`running ${this.opType}`);
            let result;
            const { builder, models, orderBy, select, sortedByDB, filter, limit, checkpoint, itemToPosition, queryProp, index } = this;
            if (sortedByDB) {
                // results come back filtered, post-processed
                result = yield this.collectInBatches();
            }
            else {
                // scan the whole table,
                // otherwise we can't apply filter, orderBy
                result = yield exec(builder);
                yield this._postProcessResult(result);
                result.Items = this._filterResults(result.Items);
            }
            let items = result.Items;
            if (!sortedByDB) {
                items = utils_1.sortResults({
                    results: items,
                    orderBy
                });
            }
            const asc = !orderBy.desc;
            if (checkpoint) {
                // if we're running a scan
                // we need to do pagination in memory
                const idx = items.map(this.table.toDBFormat).findIndex(item => {
                    for (let prop in checkpoint) {
                        if (!_.isEqual(checkpoint[prop], item[prop])) {
                            return false;
                        }
                    }
                    return true;
                });
                if (idx !== -1) {
                    items = asc ? items.slice(idx + 1) : items.slice(0, idx - 1);
                }
            }
            let startPosition;
            if (items.length) {
                startPosition = itemToPosition(items[0]);
            }
            else {
                startPosition = checkpoint;
            }
            let endPosition;
            const orderByProp = orderBy && this.table.resolveOrderBy(this.queriedPrimaryKeys.hashKey, orderBy.property);
            if (!orderBy || orderByProp === queryProp) {
                if (items.length <= limit) {
                    endPosition = getStartKey(builder);
                }
            }
            if (items.length && !endPosition) {
                const length = Math.min(limit, items.length);
                endPosition = itemToPosition(items[length - 1]);
            }
            if (items.length > limit) {
                items = items.slice(0, limit);
            }
            if (select) {
                items = items.map(item => _.pick(item, select));
            }
            return {
                items,
                startPosition,
                endPosition,
                index,
                itemToPosition
            };
        });
        this.collectInBatches = () => tslib_1.__awaiter(this, void 0, void 0, function* () {
            const { models, table, filter, limit, index, builder } = this;
            // limit how many items dynamodb iterates over before filtering
            // this is different from the sql-like notion of limit
            let batchLimit = limit;
            if (!isEmpty(filter)) {
                batchLimit = limit * 2;
                if (batchLimit < 10)
                    batchLimit = 10;
            }
            builder.limit(batchLimit);
            const getNextBatch = (started) => tslib_1.__awaiter(this, void 0, void 0, function* () {
                const promiseBatch = started ? exec(builder, 'continue') : exec(builder);
                const batch = yield promiseBatch;
                yield this._postProcessResult(batch);
                return batch;
            });
            const result = {
                ScannedCount: 0,
                Items: []
            };
            let started = false;
            do {
                let batch = yield getNextBatch(started);
                started = true;
                if (batch.Count) {
                    result.ScannedCount += batch.ScannedCount;
                    result.Items = result.Items.concat(this._filterResults(utils_1.resultsToJson(batch.Items)));
                }
                if (!batch.LastEvaluatedKey)
                    break;
            } while (result.Items.length < limit && builder.canContinue());
            return result;
        });
        this._filterResults = results => {
            const { models, model, filter } = this;
            return filter_memory_1.filterResults({
                models,
                model,
                filter,
                results
            });
        };
        this._postProcessResult = (result) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            const { table } = this;
            result.Items = result.Items.map(item => table.fromDBFormat(item));
            result.Items = yield Promise.all(result.Items.map(this._maybeInflate));
        });
        this._maybeInflate = (resource) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            let { table, select, index } = this;
            if (!select) {
                select = utils_1.getModelProperties(this.model);
            }
            select = _.uniq(select.concat(this.table.keyProps));
            const canInflateFromDB = index && index.projection.ProjectionType !== 'ALL';
            const cut = resource[constants_2.minifiedFlag] || [];
            let needsInflate;
            if (cut.length) {
                needsInflate = select.some(prop => cut.includes(prop));
            }
            else if (canInflateFromDB) {
                needsInflate = select.some(prop => !(prop in resource));
            }
            if (needsInflate) {
                if (resource._link && table.objects) {
                    return yield table.objects.get(resource._link);
                }
                return yield table.get(resource);
            }
            return resource;
        });
        this._addConditions = function () {
            const { expandedFilter, checkpoint, opType, builder, sortedByDB, table, index, select, type } = this;
            const conditionBuilders = {
                where: builder.where && builder.where.bind(builder),
                filter: builder.filter && builder.filter.bind(builder)
            };
            const { hashKey, rangeKey } = this.queriedPrimaryKeys;
            if (sortedByDB && checkpoint) {
                builder.startKey(checkpoint);
            }
            // if (select) {
            //   const atts = _.uniq(
            //       select.concat([hashKey, rangeKey, this.hashKey, this.rangeKey])
            //     )
            //     .map(key => table.prefixKey({ key, type }))
            //   builder.attributes(atts)
            // }
            for (let op in expandedFilter) {
                let conditions = expandedFilter[op];
                for (let property in conditions) {
                    if (property in OPERATORS) {
                        this._debug('nested operators not support (yet)');
                        continue;
                    }
                    if (property === this.queryProp && this.opType === 'query') {
                        // specified in key condition
                        continue;
                    }
                    if (index && !utils_1.doesIndexProjectProperty({ table, index, property })) {
                        this._debug(`index ${index.name} doesn't project property ${property}, will filter in memory`);
                        continue;
                    }
                    let comparators = comparators_1.getComparators({ queryInfo: this, property });
                    let setCondition = comparators[op];
                    if (!setCondition) {
                        this._debug(`comparator ${op} for op type ${opType} doesn't exist or is not implemented (yet)`);
                        continue;
                    }
                    let conditionMethod = !builder.filter || property === rangeKey
                        ? 'where'
                        : 'filter';
                    let conditionBuilder = conditionBuilders[conditionMethod];
                    setCondition({
                        where: conditionBuilder,
                        key: property,
                        value: conditions[property]
                    });
                }
            }
            return builder;
        };
        this._configureBuilder = function _configureBuilder() {
            const { checkpoint, opType, expandedFilter, orderBy, table, queryProp, index, consistentRead, sortedByDB } = this;
            const { EQ } = expandedFilter;
            const { type } = EQ;
            let builder;
            if (opType === 'query') {
                //   // supported key condition operators:
                //   // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions
                builder = table.table.query(EQ[queryProp]);
                if (index) {
                    builder.usingIndex(index.name);
                }
                if (sortedByDB) {
                    // ordering in DB only makes sense if results
                    // are sorted (but maybe in reverse)
                    if (orderBy.desc) {
                        builder.descending();
                    }
                    else {
                        builder.ascending();
                    }
                }
            }
            else {
                this._throwIfScanForbidden();
                // sortedByDB = !!orderBy
                builder = table.table.scan();
            }
            if (sortedByDB) {
                this._debug('full scan NOT required');
            }
            else {
                this._throwIfScanForbidden();
                this._debug('full scan required');
                builder.loadAll();
            }
            // indexes cannot be queried with consistent read
            if (consistentRead && !index) {
                builder.consistentRead();
            }
            this.builder = builder;
        };
        this._throwIfScanForbidden = function () {
            if (!this.forbidScan)
                return;
            const keySchemas = (this.table.indexes || [])
                .concat(this.table.primaryKeys)
                .map(props => _.pick(props, constants_2.PRIMARY_KEYS_PROPS));
            const hint = `Specify a limit, and a combination of hashKey in the EQ filter and (optionally) rangeKey in orderBy: ${JSON.stringify(keySchemas)}`;
            throw new Error(`this table does not allow scans or full reads. ${hint}`);
        };
        this.opts = opts;
        Object.assign(this, opts);
        this.filter = _.cloneDeep(this.filter);
        const { table, models, orderBy = constants_2.defaultOrderBy, limit = constants_2.defaultLimit, checkpoint, consistentRead, forbidScan, bodyInObjects } = this;
        this.limit = limit;
        this.orderBy = orderBy;
        this.type = this.filter.EQ[constants_1.TYPE];
        if (table.exclusive) {
            delete this.filter.EQ[constants_1.TYPE];
        }
        this.expandedFilter = exports.expandFilter(this.table, this.filter);
        Object.assign(this, utils_1.getQueryInfo({
            table: this.table,
            filter: this.expandedFilter,
            orderBy: this.orderBy
        }));
        const { type } = this;
        this.model = models[type];
        this._configureBuilder();
        this._addConditions();
    }
    get queriedPrimaryKeys() {
        const { hashKey, rangeKey } = this.index || this.table;
        return { hashKey, rangeKey };
    }
}
const exec = (builder, method = 'exec') => tslib_1.__awaiter(this, void 0, void 0, function* () {
    try {
        return yield utils_1.promisify(builder[method].bind(builder))();
    }
    catch (err) {
        if (err.code === 'ResourceNotFoundException') {
            return {
                Count: 0,
                ScannedCount: 0,
                Items: []
            };
        }
        throw err;
    }
});
const getStartKey = builder => builder.request.ExclusiveStartKey;
// function usesNonPrimaryKeys ({ model, filter }) {
//   return props.some(prop => !indexed[prop])
// }
const isEmpty = obj => {
    return !obj || Object.keys(obj).length === 0;
};
const notNull = val => !!val;
function default_1(opts) {
    return new FilterOp(opts).exec();
}
exports.default = default_1;
exports.expandFilter = (table, filter) => {
    const expandedFilter = _.cloneDeep(filter);
    if (expandedFilter.EQ) {
        table.addDerivedProperties(expandedFilter.EQ);
    }
    return expandedFilter;
};
//# sourceMappingURL=filter-dynamodb.js.map
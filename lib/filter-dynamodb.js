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
        this.exec = () => __awaiter(this, void 0, void 0, function* () {
            let result;
            const { builder, models, orderBy, sortedByDB, filter, after, limit, itemToPosition, queryProp, index } = this;
            if (sortedByDB) {
                // results come back filtered, post-processed
                result = yield this.collectInBatches();
            }
            else {
                // scan the whole table,
                // otherwise we can't apply filter, orderBy
                result = yield exec(builder);
                yield this._postProcessResult(result);
                result.Items = filter_memory_1.filterResults({
                    models,
                    filter,
                    results: result.Items
                });
            }
            let items = result.Items;
            if (!sortedByDB) {
                items = utils_1.sortResults({
                    results: items,
                    orderBy
                });
            }
            if (after) {
                // if we're running a scan
                // we need to do pagination in memory
                const idx = items.map(this.table.toDBFormat).findIndex(item => {
                    for (let prop in after) {
                        if (!utils_1.deepEqual(after[prop], item[prop])) {
                            return false;
                        }
                    }
                    return true;
                });
                if (idx !== -1) {
                    items = items.slice(idx + 1);
                }
            }
            let startPosition;
            if (items.length) {
                startPosition = this.itemToPosition(items[0]);
            }
            else {
                startPosition = after && this.itemToPosition(after);
            }
            let endPosition;
            if (!orderBy || orderBy.property === queryProp) {
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
            return {
                items,
                startPosition,
                endPosition,
                index,
                itemToPosition
            };
        });
        this.collectInBatches = () => __awaiter(this, void 0, void 0, function* () {
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
            const getNextBatch = (started) => __awaiter(this, void 0, void 0, function* () {
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
                    result.Items = result.Items.concat(filter_memory_1.filterResults({
                        models,
                        filter,
                        results: utils_1.resultsToJson(batch.Items)
                    }));
                }
                if (!batch.LastEvaluatedKey)
                    break;
            } while (result.Items.length < limit && builder.canContinue());
            return result;
        });
        this._postProcessResult = (result) => __awaiter(this, void 0, void 0, function* () {
            const { table, index } = this;
            if (index && index.projection.ProjectionType !== 'ALL') {
                this._debug('inflating due to use of index');
                if (this.bodyInObjects) {
                    result.Items = yield Promise.all(result.Items.map(table.inflate));
                }
                else {
                    result.Items = yield Promise.all(result.Items.map(table.get));
                }
            }
        });
        this._addConditions = function () {
            const { prefixedFilter, after, opType, builder, sortedByDB, index } = this;
            const conditionBuilders = {
                where: builder.where && builder.where.bind(builder),
                filter: builder.filter && builder.filter.bind(builder)
            };
            if (after) {
                if (sortedByDB) {
                    builder.startKey(after);
                }
            }
            const comparators = comparators_1.getComparators(opType);
            for (let op in prefixedFilter) {
                let setCondition = comparators[op];
                if (!setCondition) {
                    this._debug(`comparator ${op} for op type ${opType} doesn't exist or is not implemented (yet)`);
                    continue;
                }
                let conditions = prefixedFilter[op];
                for (let property in conditions) {
                    if (property in OPERATORS) {
                        this._debug('nested operators not support (yet)');
                        continue;
                    }
                    if (index && !utils_1.doesIndexProjectProperty({ index, property })) {
                        this._debug(`index ${index.name} doesn't project property ${property}, will filter in memory`);
                        continue;
                    }
                    let conditionMethod = !builder.filter || property === this.primaryKeys.rangeKey
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
            const { opType, filter, orderBy, table, queryProp, index, consistentRead, sortedByDB } = this;
            const { EQ } = filter;
            const { type } = EQ;
            const createBuilder = table[opType];
            let builder;
            if (opType === 'query') {
                //   // supported key condition operators:
                //   // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions
                builder = createBuilder(EQ[queryProp]);
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
                builder = createBuilder();
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
            const propsMap = (this.table.indexes || []).concat(this.table)
                .map(({ rangeKey }) => rangeKey)
                .filter(notNull)
                .reduce((have, next) => {
                have[next] = true;
                return have;
            }, {});
            const props = Object.keys(propsMap);
            const hint = props.length
                ? `Specify a limit and one of the following orderBy properties: ${props.join(', ')}`
                : '';
            throw new Error(`this table does not allow scans or full reads. ${hint}`);
        };
        const { table, models, filter = {}, orderBy = constants_2.defaultOrderBy, limit = constants_2.defaultLimit, after, consistentRead, forbidScan, bodyInObjects } = opts;
        Object.assign(this, opts);
        this.filter = utils_1.clone(filter);
        this.limit = limit;
        this.orderBy = orderBy;
        Object.assign(this, utils_1.getQueryInfo(this));
        this.prefixedFilter = {};
        const type = filter.EQ[constants_1.TYPE];
        this.prefixedOrderBy = {
            property: table.prefixKey({
                type,
                key: orderBy.property || table.rangeKey
            }),
            desc: orderBy.desc
        };
        for (let operator in OPERATORS) {
            if (operator in filter) {
                this.prefixedFilter[operator] = table.prefixPropertiesForType(type, filter[operator]);
            }
        }
        delete this.prefixedFilter.EQ[this.queryProp];
        this._configureBuilder();
        this._addConditions();
        this._debug(`running ${this.opType}`);
    }
}
const exec = (builder, method = 'exec') => __awaiter(this, void 0, void 0, function* () {
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
const getStartKey = builder => {
    return builder.request.ExclusiveStartKey;
};
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
//# sourceMappingURL=filter-dynamodb.js.map
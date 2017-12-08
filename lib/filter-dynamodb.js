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
const dExp = require("dynamodb-exp");
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
            this._debug(`running ${this.opType}`);
            const { builder, models, orderBy, sortedByDB, filter, limit, checkpoint, itemToPosition, queryProp, index } = this;
            const result = {
                ScannedCount: 0,
                Items: []
            };
            let lastEvaluatedKey;
            yield dExp.batchProcess({
                builder,
                client: this.table.opts.docClient,
                worker: (batch) => __awaiter(this, void 0, void 0, function* () {
                    if (batch.Count) {
                        yield this._postProcessResult(batch);
                        result.ScannedCount += batch.ScannedCount;
                        result.Items = result.Items.concat(this._filterResults(utils_1.resultsToJson(batch.Items)));
                    }
                    // if results are not sorted by db,
                    // scan the whole table,
                    // otherwise we can't apply filter, orderBy
                    if (batch.LastEvaluatedKey) {
                        lastEvaluatedKey = batch.LastEvaluatedKey;
                    }
                    else
                        (batch, Count) => {
                            lastEvaluatedKey = itemToPosition(batch.Items[batch.Items.length - 1]);
                        };
                    return sortedByDB ? result.Items.length < limit : true;
                })
            });
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
                        if (!utils_1.deepEqual(checkpoint[prop], item[prop])) {
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
            if (!orderBy || orderBy.property === queryProp) {
                if (items.length <= limit) {
                    endPosition = lastEvaluatedKey;
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
        this._filterResults = results => {
            const { models, model, filter } = this;
            return filter_memory_1.filterResults({
                models,
                model,
                filter,
                results
            });
        };
        this._postProcessResult = (result) => __awaiter(this, void 0, void 0, function* () {
            const { table } = this;
            result.Items = result.Items.map(item => table.fromDBFormat(item));
            result.Items = yield Promise.all(result.Items.map(this._maybeInflate));
        });
        this._maybeInflate = (resource) => __awaiter(this, void 0, void 0, function* () {
            let { table, select, index } = this;
            if (!select) {
                select = utils_1.getModelProperties(this.model);
            }
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
            const { prefixedFilter, checkpoint, opType, builder, sortedByDB, table, index } = this;
            const { hashKey, rangeKey } = index || this;
            if (sortedByDB && checkpoint) {
                builder.startKey(checkpoint);
            }
            for (let op in prefixedFilter) {
                let conditions = prefixedFilter[op];
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
                    setCondition({
                        where: builder.where,
                        key: property,
                        value: conditions[property]
                    });
                }
            }
            return builder;
        };
        this._configureBuilder = function _configureBuilder() {
            const { checkpoint, opType, filter, orderBy, table, queryProp, index, consistentRead, limit, sortedByDB } = this;
            const { EQ } = filter;
            const { type } = EQ;
            let builder = dExp.op({ schema: this.table.schema });
            if (opType === 'query') {
                //   // supported key condition operators:
                //   // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions
                builder = builder.query();
                if (index) {
                    builder.usingIndex(index.name);
                }
                builder.where(queryProp).eq(EQ[queryProp]);
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
                builder = builder.scan();
                this.mustLoadAll = true;
            }
            if (sortedByDB) {
                this._debug('full scan NOT required');
            }
            else {
                this._throwIfScanForbidden();
                this._debug('full scan required');
                // builder.loadAll()
                this.mustLoadAll = true;
            }
            // indexes cannot be queried with consistent read
            if (consistentRead && !index) {
                builder.consistentRead();
            }
            this.builder = builder;
            if (limit) {
                builder.limit(limit * 2);
            }
        };
        this._throwIfScanForbidden = function () {
            if (!this.forbidScan)
                return;
            const keySchemas = (this.table.indexes || []).concat(this.table.primaryKeys)
                .map(props => utils_1.pick(props, ['hashKey', 'rangeKey']));
            const hint = `Specify a limit, and a combination of hashKey in the EQ filter and (optionally) rangeKey in orderBy: ${JSON.stringify(keySchemas)}`;
            throw new Error(`this table does not allow scans or full reads. ${hint}`);
        };
        this.opts = opts;
        Object.assign(this, opts);
        this.filter = utils_1.clone(this.filter);
        const { table, models, orderBy = constants_2.defaultOrderBy, limit = constants_2.defaultLimit, checkpoint, consistentRead, forbidScan, bodyInObjects } = this;
        this.limit = limit;
        this.orderBy = orderBy;
        Object.assign(this, utils_1.getQueryInfo(this));
        this.prefixedFilter = {};
        const type = this.filter.EQ[constants_1.TYPE];
        if (table.exclusive) {
            delete this.filter.EQ[constants_1.TYPE];
        }
        this.model = models[type];
        this.prefixedOrderBy = {
            property: table.prefixKey({
                type,
                key: orderBy.property || table.rangeKey
            }),
            desc: orderBy.desc
        };
        for (let operator in this.filter) {
            if (operator in OPERATORS) {
                this.prefixedFilter[operator] = table.prefixPropertiesForType(type, this.filter[operator]);
            }
        }
        this._configureBuilder();
        this._addConditions();
    }
}
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
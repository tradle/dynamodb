"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const _ = require("lodash");
const errors_1 = tslib_1.__importDefault(require("@tradle/errors"));
const constants_1 = require("@tradle/constants");
const validate_model_1 = tslib_1.__importDefault(require("@tradle/validate-model"));
const utils_1 = require("./utils");
const OPERATORS = require("./operators");
const comparators_1 = require("./comparators");
const filter_memory_1 = require("./filter-memory");
const constants_2 = require("./constants");
const { isComplexProperty } = validate_model_1.default.utils;
class FilterOp {
    constructor(opts) {
        this._debug = (message, ...rest) => {
            this.table.logger.debug(`search:${this.opType}: ${message}`, ...rest);
        };
        this._normalizeSelect = (select) => {
            const raw = select.concat(_.values(this.queriedPrimaryKeys))
                .concat(this.table.primaryKeyProps);
            return _.uniq(raw);
        };
        this.guessSelect = () => {
            return this._normalizeSelect(utils_1.getModelProperties(this.model));
        };
        this.exec = async () => {
            this._debug(`running ${this.opType}`);
            let result;
            const { table, model, models, builder, orderBy, defaultOrderBy, select, sortedByDB, filter, limit, checkpoint, itemToPosition, queryProp, index } = this;
            if (sortedByDB) {
                // results come back filtered, post-processed
                result = await this.collectInBatches();
            }
            else {
                // scan the whole table,
                // otherwise we can't apply filter, orderBy
                result = await exec(builder);
                await this._postProcessResult(result);
                result.Items = this._filterResults(result.Items);
            }
            let items = result.Items;
            if (!sortedByDB) {
                items = this.sortResults(items);
            }
            const asc = !(orderBy && orderBy.desc);
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
            // const orderByProp = orderBy && this.table.resolveOrderBy({
            //   type: this.type,
            //   hashKey: this.queriedPrimaryKeys.hashKey,
            //   property: orderBy.property
            // })
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
            // this sometimes messes things up for graphql
            // maybe we shouldn't handle select as strictly and let the caller prune
            if (select) {
                // a shame to do this again, already did in _maybeInflate
                items = items.map(item => _.pick(item, select)).map(resource => _.merge(table.parseDerivedProps({
                    table,
                    model,
                    resource,
                }), resource));
            }
            return {
                items,
                startPosition,
                endPosition,
                index,
                itemToPosition
            };
        };
        this.sortResults = results => utils_1.sortResults({
            results,
            orderBy: this.orderBy,
            defaultOrderBy: this.defaultOrderBy
        });
        this.collectInBatches = async () => {
            const { models, table, filter, limit, index, builder } = this;
            // limit how many items dynamodb iterates over before filtering
            // this is different from the sql-like notion of limit
            let { batchLimit } = this;
            if (!batchLimit) {
                batchLimit = limit;
                if (!isEmpty(filter)) {
                    batchLimit = limit * 2;
                    if (batchLimit < 10)
                        batchLimit = 10;
                }
            }
            builder.limit(batchLimit);
            const getNextBatch = async (started) => {
                const promiseBatch = started ? exec(builder, 'continue') : exec(builder);
                const batch = await promiseBatch;
                await this._postProcessResult(batch);
                return batch;
            };
            const result = {
                ScannedCount: 0,
                Items: []
            };
            let started = false;
            do {
                let batch = await getNextBatch(started);
                started = true;
                if (batch.Count) {
                    result.ScannedCount += batch.ScannedCount;
                    result.Items = result.Items.concat(this._filterResults(table.fromDBFormat(batch.Items)));
                }
                if (!batch.LastEvaluatedKey)
                    break;
            } while (result.Items.length < limit && builder.canContinue());
            return result;
        };
        this._filterResults = results => {
            const { models, model, filter } = this;
            return filter_memory_1.filterResults({
                models,
                model,
                filter,
                results
            });
        };
        this._postProcessResult = async (result) => {
            const { table } = this;
            result.Items = result.Items.map(item => table.fromDBFormat(item));
            result.Items = await Promise.all(result.Items.map(this._maybeInflate));
        };
        this._maybeInflate = async (resource) => {
            let { table, select, decisionProps, index, model, queriedPrimaryKeys } = this;
            if (!select) {
                select = this.guessSelect();
            }
            resource = Object.assign({ [constants_1.TYPE]: model.id }, resource);
            resource = _.merge(table.parseDerivedProps({
                table,
                model,
                resource,
            }), resource);
            const canInflateFromDB = index && index.projection.ProjectionType !== 'ALL';
            const cut = resource[constants_2.minifiedFlag] || [];
            let needsInflate;
            if (cut.length) {
                needsInflate = decisionProps.some(prop => cut.includes(prop));
            }
            else if (canInflateFromDB) {
                needsInflate = decisionProps.some(name => {
                    if (!(name in resource))
                        return true;
                    // TODO:
                    // this can cause additional fetching, when it's not needed
                    //
                    // if "select" specifies paths vs top-level props
                    // e.g. ["a.a1", "a.a2"] vs ["a"]
                    // then this sacrifice won't be necessary
                    const property = model.properties[name];
                    return property && isComplexProperty(property);
                });
            }
            if (needsInflate) {
                let more;
                if (resource._link && table.objects) {
                    try {
                        more = await table.objects.get(resource._link);
                    }
                    catch (err) {
                        errors_1.default.rethrow(err, 'developer');
                        this._debug('failed to inflate via object storages', _.pick(resource, ['_t', '_link']));
                    }
                }
                else {
                    more = await table.get(resource);
                }
                if (more) {
                    return Object.assign({}, resource, more);
                }
            }
            return resource;
        };
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
                    if (orderBy && orderBy.desc) {
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
            if (this.allowScan === true)
                return;
            if (typeof this.allowScan === 'function') {
                const allow = this.allowScan(this);
                if (allow !== false)
                    return;
            }
            // const keySchemas = (this.table.indexes || [])
            //   .concat(this.table.primaryKeys)
            //   .map(props => _.pick(props, PRIMARY_KEYS_PROPS))
            const { primaryKeys, indexes } = this.model;
            const indexed = [].concat(primaryKeys).concat(indexes);
            const indexedStr = JSON.stringify(indexed);
            const hint = `Specify a limit, and a combination of hashKey in the EQ filter and (optionally) rangeKey in orderBy for one of the following: ${indexedStr}`;
            throw new Error(`this table does not allow scans or full reads. ${hint}`);
        };
        this.opts = opts;
        Object.assign(this, opts);
        this.filter = _.cloneDeep(this.filter);
        const { table, models, orderBy, limit = constants_2.defaultLimit, checkpoint, consistentRead, allowScan, bodyInObjects, select } = this;
        this.limit = limit;
        this.orderBy = orderBy;
        this.type = this.filter.EQ[constants_1.TYPE];
        if (table.exclusive) {
            delete this.filter.EQ[constants_1.TYPE];
        }
        this.expandedFilter = exports.expandFilter(this.table, this.filter);
        Object.assign(this, utils_1.getQueryInfo({
            type: this.type,
            table: this.table,
            filter: this.expandedFilter,
            orderBy: this.orderBy
        }));
        const { type } = this;
        this.model = models[type];
        this._configureBuilder();
        this._addConditions();
        if (select) {
            this.select = this._normalizeSelect(select);
        }
        this.decisionProps = utils_1.getDecisionProps({
            filter: this.filter,
            select: this.select || this.guessSelect()
        });
    }
    get queriedPrimaryKeys() {
        const { hashKey, rangeKey } = this.index || this.table;
        return { hashKey, rangeKey };
    }
}
exports.FilterOp = FilterOp;
const exec = async (builder, method = 'exec') => {
    try {
        return await utils_1.promisify(builder[method].bind(builder))();
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
};
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
const expandableOperators = [
    'NEQ',
    'NULL',
    'LT',
    'LTE',
    'GT',
    'GTE',
];
exports.expandFilter = (table, filter) => {
    const expandedFilter = _.cloneDeep(filter);
    if (!filter.EQ)
        return expandedFilter;
    const addProps = (target, noConstants) => _.extend(target, utils_1.deriveProps({
        table,
        item: target,
        isRead: true,
        noConstants
    }));
    addProps(expandedFilter.EQ);
    const { EQ } = expandedFilter;
    const type = EQ[constants_1.TYPE];
    let dangerous;
    _.intersection(Object.keys(filter), expandableOperators).forEach(op => {
        const opInfo = OPERATORS[op];
        const props = expandedFilter[op];
        const delType = !props[constants_1.TYPE];
        if (delType)
            props[constants_1.TYPE] = type;
        const copy = _.clone(props);
        addProps(copy, true);
        const keep = Object.keys(copy).filter(p => !(p in props) && !(p in EQ));
        if (keep.length) {
            _.extend(props, _.pick(copy, keep));
            dangerous = true;
        }
        if (delType)
            delete props[constants_1.TYPE];
    });
    // console.warn('performed dangerous filter expansion', _.omit(expandedFilter, 'EQ'))
    return expandedFilter;
};
//# sourceMappingURL=filter-dynamodb.js.map
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
const _ = require("lodash");
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
const defaultTableChooser = ({ tables, type }) => {
    return utils_1.minBy(tables, (table, i) => utils_1.levenshteinDistance(utils_1.sha256(type), utils_1.sha256(table.name)));
};
class DB extends events_1.EventEmitter {
    constructor({ tableNames, defineTable, chooseTable = defaultTableChooser, modelStore }) {
        super();
        this.setExclusive = ({ model, table }) => {
            if (!table)
                throw new Error('expected "table"');
            if (!model)
                model = table.model;
            if (!model)
                throw new Error('expected "model"');
            this.tablesByName[model.id] = table;
            this.tables[model.id] = table;
            this.exclusive[model.id] = table;
        };
        this.choose = (type) => __awaiter(this, void 0, void 0, function* () {
            const model = yield this.modelStore.get(type);
            const table = this._choose({
                tables: this.tableTableNames.map(name => this.tablesByName[name]),
                type
            });
            if (!table) {
                throw new Error(`table not found for type ${type}`);
            }
            // save alias
            this.tables[type] = table;
            table.addModel({
                model: this.models[type]
            });
            return table;
        });
        this.put = (resource, opts) => __awaiter(this, void 0, void 0, function* () {
            const table = yield this.getTableForModel(resource[constants_1.TYPE]);
            return yield table.put(resource, opts);
        });
        this.update = (resource, opts) => __awaiter(this, void 0, void 0, function* () {
            const table = yield this.getTableForModel(resource[constants_1.TYPE]);
            return yield table.update(resource, opts);
        });
        this.merge = (resource, opts) => __awaiter(this, void 0, void 0, function* () {
            const table = yield this.getTableForModel(resource[constants_1.TYPE]);
            return yield table.merge(resource, opts);
        });
        this.get = (keys, opts) => __awaiter(this, void 0, void 0, function* () {
            const table = yield this.getTableForModel(keys[constants_1.TYPE]);
            return yield table.get(keys, opts);
        });
        this.latest = (keys, opts) => __awaiter(this, void 0, void 0, function* () {
            const table = yield this.getTableForModel(keys[constants_1.TYPE]);
            return yield table.latest(keys, opts);
        });
        this.del = (keys) => __awaiter(this, void 0, void 0, function* () {
            const table = yield this.getTableForModel(keys[constants_1.TYPE]);
            yield table.del(keys);
        });
        this.getTableForModel = (model) => __awaiter(this, void 0, void 0, function* () {
            const type = typeof model === 'string' ? model : model.id;
            return this.tables[type] || this.choose(type);
        });
        this.batchPut = (resources, opts) => __awaiter(this, void 0, void 0, function* () {
            const byTable = new Map();
            // prime cache
            resources.forEach(resource => this.getTableForModel(resource[constants_1.TYPE]));
            const byType = _.groupBy(resources, constants_1.TYPE);
            const results = yield Promise.all(_.map(byType, (batch, type) => __awaiter(this, void 0, void 0, function* () {
                const table = yield this.getTableForModel(type);
                return table.batchPut(batch, opts);
            })));
            return _.flatten(results);
        });
        this.find = (opts) => __awaiter(this, void 0, void 0, function* () {
            const type = utils_1.getFilterType(opts);
            const table = yield this.getTableForModel(type);
            return yield table.find(opts);
        });
        this.findOne = (opts) => __awaiter(this, void 0, void 0, function* () {
            const type = utils_1.getFilterType(opts);
            const table = yield this.getTableForModel(type);
            return yield table.findOne(opts);
        });
        this.search = (opts) => this.find(opts);
        this.createTables = () => __awaiter(this, void 0, void 0, function* () {
            for (const name of this._getTablesNames()) {
                yield this.tablesByName[name].create();
            }
        });
        this.destroyTables = () => __awaiter(this, void 0, void 0, function* () {
            for (const name of this._getTablesNames()) {
                yield this.tablesByName[name].destroy();
            }
        });
        // public hasTableForModel = (model:any|string) => {
        //   const id = typeof model === 'string' ? model : model.id
        //   return !!this.tables[id]
        // }
        this._getTablesNames = () => {
            return this.tableTableNames.concat(Object.keys(this.exclusive));
        };
        if (!(modelStore &&
            Array.isArray(tableNames) &&
            typeof defineTable === 'function' &&
            typeof chooseTable === 'function')) {
            throw new Error('missing required parameter');
        }
        this.modelStore = modelStore;
        this.modelStore.on('invalidate:model', ({ id }) => {
            delete this.tables[id];
        });
        tableNames.forEach(utils_1.validateTableName);
        this.tableTableNames = tableNames;
        this.exclusive = {};
        this._choose = chooseTable;
        this._instantiateTable = defineTable;
        this.tables = {};
        this.tablesByName = {};
        utils_1.lazyDefine(this.tablesByName, this.tableTableNames, this._instantiateTable);
        for (let id in this.exclusive) {
            let table = this.exclusive[id];
            this.tables[table.model.id] = table;
            this.tablesByName[table.name] = table;
        }
    }
    get models() {
        return this.modelStore.models;
    }
}
DB.getSafeTableName = model => utils_1.getTableName({ model });
exports.default = DB;
//# sourceMappingURL=db.js.map
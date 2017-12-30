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
const validateResource = require("@tradle/validate-resource");
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
const { isInstantiable } = validateResource.utils;
const defaultTableChooser = ({ tables, type }) => {
    return utils_1.minBy(tables, (table, i) => utils_1.levenshteinDistance(utils_1.sha256(type), utils_1.sha256(table.name)));
};
class DB extends events_1.EventEmitter {
    constructor({ models, tableNames, defineTable, chooseTable = defaultTableChooser }) {
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
        this.choose = (type) => {
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
        };
        this.put = (item, opts) => __awaiter(this, void 0, void 0, function* () {
            return yield this.tables[item[constants_1.TYPE]].put(item, opts);
        });
        this.update = (resource, opts) => __awaiter(this, void 0, void 0, function* () {
            return yield this.tables[resource[constants_1.TYPE]].update(resource, opts);
        });
        this.merge = (resource, opts) => __awaiter(this, void 0, void 0, function* () {
            return yield this.tables[resource[constants_1.TYPE]].merge(resource, opts);
        });
        this.get = (keys, opts) => __awaiter(this, void 0, void 0, function* () {
            return yield this.tables[keys[constants_1.TYPE]].get(keys, opts);
        });
        this.latest = (keys, opts) => __awaiter(this, void 0, void 0, function* () {
            return yield this.tables[keys[constants_1.TYPE]].latest(keys, opts);
        });
        this.del = (keys) => __awaiter(this, void 0, void 0, function* () {
            yield this.tables[keys[constants_1.TYPE]].del(keys);
        });
        this.batchPut = (resources, opts) => __awaiter(this, void 0, void 0, function* () {
            const byTable = new Map();
            for (const resource of resources) {
                const type = resource[constants_1.TYPE];
                const table = this.tables[type];
                const soFar = byTable.get(table) || [];
                soFar.push(resource);
                byTable.set(table, soFar);
            }
            const entries = Array.from(byTable.entries());
            const results = yield Promise.all(entries.map(([table, resources]) => {
                return table.batchPut(resources, opts);
            }));
            return results.reduce((flat, item) => flat.concat(item), []);
        });
        this.find = (opts) => __awaiter(this, void 0, void 0, function* () {
            const type = utils_1.getFilterType(opts);
            return yield this.tables[type].find(opts);
        });
        this.findOne = (opts) => __awaiter(this, void 0, void 0, function* () {
            const type = utils_1.getFilterType(opts);
            return yield this.tables[type].findOne(opts);
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
        this.addModels = (models) => {
            if (Object.keys(models).length) {
                this.setModels(Object.assign({}, this.models, models));
            }
        };
        this.setModels = (models) => {
            this.models = models;
            this.tables = {};
            this.tablesByName = {};
            utils_1.lazyDefine(this.tablesByName, this.tableTableNames, this._instantiateTable);
            utils_1.lazyDefine(this.tables, Object.keys(models), type => this.choose(type));
            for (let id in this.exclusive) {
                let table = this.exclusive[id];
                this.tables[table.model.id] = table;
                this.tablesByName[table.name] = table;
            }
            this.emit('update:models', { models });
        };
        this.hasTableForModel = (model) => {
            const id = typeof model === 'string' ? model : model.id;
            return !!this.tables[id];
        };
        this._getTablesNames = () => {
            return this.tableTableNames.concat(Object.keys(this.exclusive));
        };
        if (!(models &&
            Array.isArray(tableNames) &&
            typeof defineTable === 'function' &&
            typeof chooseTable === 'function')) {
            throw new Error('missing required parameter');
        }
        tableNames.forEach(utils_1.validateTableName);
        this.tableTableNames = tableNames;
        this.exclusive = {};
        this._choose = chooseTable;
        this._instantiateTable = defineTable;
        this.setModels(models);
    }
}
DB.getSafeTableName = model => utils_1.getTableName({ model });
exports.default = DB;
//# sourceMappingURL=db.js.map
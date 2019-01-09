"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const events_1 = require("events");
const _ = require("lodash");
const constants_1 = require("@tradle/constants");
const event_hooks_1 = tslib_1.__importDefault(require("event-hooks"));
const utils_1 = require("./utils");
const defaults = tslib_1.__importStar(require("./defaults"));
const HOOKABLE = [
    'put',
    'update',
    'merge',
    'get',
    'del',
    'batchPut',
    'find',
    'findOne',
    'createTable',
    'destroyTable'
];
const defaultTableChooser = ({ tables, type }) => {
    return utils_1.minBy(tables, (table, i) => utils_1.levenshteinDistance(utils_1.sha256(type), utils_1.sha256(table.name)));
};
class DB extends events_1.EventEmitter {
    constructor({ tableNames, defineTable, chooseTable = defaultTableChooser, modelStore, logger = defaults.logger }) {
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
        this.choose = async (type) => {
            const model = await this.modelStore.get(type);
            return this._chooseTableForModel(model);
        };
        this.put = async (resource, opts) => {
            const table = await this.getTableForType(resource[constants_1.TYPE]);
            return await table.put(resource, opts);
        };
        this.update = async (resource, opts) => {
            const table = await this.getTableForType(resource[constants_1.TYPE]);
            return await table.update(resource, opts);
        };
        this.merge = async (resource, opts) => {
            const table = await this.getTableForType(resource[constants_1.TYPE]);
            return await table.merge(resource, opts);
        };
        this.get = async (keys, opts) => {
            const table = await this.getTableForType(keys[constants_1.TYPE]);
            return await table.get(keys, opts);
        };
        this.del = async (keys, opts) => {
            const table = await this.getTableForType(keys[constants_1.TYPE]);
            return await table.del(keys, opts);
        };
        this.getTableForType = async (type) => {
            return this.tables[type] || this.choose(type);
        };
        this.getTableForModel = (model) => {
            return this.tables[model.id] || this._chooseTableForModel(model);
        };
        this.batchPut = async (resources, opts) => {
            const byTable = new Map();
            // prime cache
            resources.forEach(resource => this.getTableForType(resource[constants_1.TYPE]));
            const byType = _.groupBy(resources, constants_1.TYPE);
            const results = await Promise.all(_.map(byType, async (batch, type) => {
                const table = await this.getTableForType(type);
                return table.batchPut(batch, opts);
            }));
            return _.flatten(results);
        };
        this.find = async (opts) => {
            const type = utils_1.getFilterType(opts);
            const table = await this.getTableForType(type);
            return await table.find(opts);
        };
        this.findOne = async (opts) => {
            const type = utils_1.getFilterType(opts);
            const table = await this.getTableForType(type);
            return await table.findOne(opts);
        };
        this.search = (opts) => this.find(opts);
        this.list = async (type, opts) => {
            const table = await this.getTableForType(type);
            return await table.list(type, opts);
        };
        this.reindex = async (opts) => {
            const table = this.getTableForModel(opts.model);
            return await table.reindex(opts);
        };
        this.createTables = async () => {
            for (const name of this._getTablesNames()) {
                await this.createTable(name);
            }
        };
        this.destroyTables = async () => {
            for (const name of this._getTablesNames()) {
                await this.tablesByName[name].destroy();
            }
        };
        this.hook = (method, handler) => this.hooks.hook(method, handler);
        // public hasTableForModel = (model:any|string) => {
        //   const id = typeof model === 'string' ? model : model.id
        //   return !!this.tables[id]
        // }
        this.createTable = async (name) => {
            await this.tablesByName[name].create();
        };
        this.destroyTable = async (name) => {
            await this.tablesByName[name].destroy();
        };
        this._getTablesNames = () => {
            return this.tableTableNames.concat(Object.keys(this.exclusive));
        };
        this._chooseTableForModel = (model) => {
            const type = model.id;
            const table = this._choose({
                tables: this.tableTableNames.map(name => this.tablesByName[name]),
                type
            });
            if (!table) {
                throw new Error(`table not found for type ${type}`);
            }
            // save alias
            this.tables[type] = table;
            table.storeResourcesForModel({
                model: this.models[type]
            });
            return table;
        };
        this.logger = logger;
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
        this.hooks = event_hooks_1.default();
        HOOKABLE.forEach(method => {
            this[method] = utils_1.hookUp(this[method].bind(this), method);
        });
    }
    get models() {
        return this.modelStore.models;
    }
}
DB.getSafeTableName = model => utils_1.getTableName({ model });
exports.default = DB;
exports.createDB = (opts) => new DB(opts);
//# sourceMappingURL=db.js.map
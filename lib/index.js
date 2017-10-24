"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const table_1 = require("./table");
exports.Table = table_1.default;
const db_1 = require("./db");
exports.DB = db_1.default;
const utils = require("./utils");
exports.utils = utils;
const constants = require("./constants");
exports.constants = constants;
const errors = require("./errors");
exports.errors = errors;
const createResolvers = require("./resolvers");
exports.createResolvers = createResolvers;
const createTable = (name, opts) => new table_1.default(name, opts);
exports.createTable = createTable;
//# sourceMappingURL=index.js.map
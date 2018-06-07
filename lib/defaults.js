"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("@tradle/constants");
const debug = require('debug')(require('../package.json').name);
exports.primaryKeys = {
    // default for all tradle.Object resources
    hashKey: '_permalink',
    rangeKey: {
        template: '_' // constant
    }
};
exports.indexes = [
    {
        // default for all tradle.Object resources
        hashKey: '_author',
        rangeKey: '_time'
    },
    {
        // default for all tradle.Object resources
        hashKey: constants_1.TYPE,
        rangeKey: '_time'
    }
];
exports.logger = {
    log: debug,
    error: debug.bind(null, '[ERROR]'),
    warn: debug.bind(null, '[WARN]'),
    info: debug.bind(null, '[INFO]'),
    debug: debug.bind(null, '[DEBUG]'),
    silly: debug.bind(null, '[SILLY]'),
};
//# sourceMappingURL=defaults.js.map
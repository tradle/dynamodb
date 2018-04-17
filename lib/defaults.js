"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("@tradle/constants");
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
//# sourceMappingURL=defaults.js.map
"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
}
const lodash_1 = __importDefault(require("lodash"));
const constants_1 = require("@tradle/constants");
// const keyAndValue = prop => item => `${prop}:${item[prop]}`
const defaultIndexPropertyNames = lodash_1.default.range(5).map(i => `__x__${i}`);
const authorIndex = {
    hashKey: defaultIndexPropertyNames[0],
    rangeKey: '_time',
    // name: '_author',
    name: 'idx0',
    type: 'global',
    // expensive
    // can we get away with ProjectionType KEYS_ONLY?
    projection: {
        ProjectionType: 'INCLUDE',
        NonKeyAttributes: [constants_1.TYPE, '_link']
    }
};
const typeIndex = {
    hashKey: defaultIndexPropertyNames[1],
    rangeKey: '_time',
    // name: 'type',
    name: 'idx1',
    type: 'global',
    // expensive
    // can we get away with ProjectionType KEYS_ONLY?
    projection: {
        ProjectionType: 'INCLUDE',
        NonKeyAttributes: ['_author', '_link']
    }
};
const defaultIndexes = [authorIndex, typeIndex];
const typeAndPermalinkProperty = '_tpermalink';
const defaultHashKeyProperty = '__hashKey__';
const defaultRangeKeyProperty = '__rangeKey__';
const constants = {
    // typeAndPermalinkProperty,
    minifiedFlag: '_cut',
    separator: '_',
    // defaultHashKeyProperty,
    // defaultRangeKeyProperty,
    // defaultPrimaryKeys: {
    //   hashKey: defaultHashKeyProperty
    //   // hashKey: typeAndPermalinkProperty
    // },
    // defaultIndexes,
    defaultOrderBy: {
        property: '_time',
        desc: true
    },
    dateModifiedProperty: '_dateModified',
    defaultLimit: 50,
    batchWriteLimit: 25,
    PRIMARY_KEYS_PROPS: ['hashKey', 'rangeKey'],
};
module.exports = constants;
//# sourceMappingURL=constants.js.map
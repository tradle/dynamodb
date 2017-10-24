"use strict";
const constants_1 = require("@tradle/constants");
const defaultIndex = {
    hashKey: '_author',
    rangeKey: '_time',
    name: '_author',
    type: 'global',
    // expensive
    // can we get away with ProjectionType KEYS_ONLY?
    projection: {
        ProjectionType: 'INCLUDE',
        NonKeyAttributes: [constants_1.TYPE]
    }
};
const defaultIndexes = [defaultIndex];
const typeAndPermalinkProperty = '_tpermalink';
const constants = {
    typeAndPermalinkProperty,
    minifiedFlag: '_cut',
    separator: '_',
    defaultPrimaryKeys: {
        hashKey: typeAndPermalinkProperty
    },
    defaultIndexes,
    defaultOrderBy: {
        property: '_time',
        desc: true
    },
    dateModifiedProperty: '_dateModified',
    defaultLimit: 50,
    batchWriteLimit: 25
};
module.exports = constants;
//# sourceMappingURL=constants.js.map
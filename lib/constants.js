"use strict";
const constants_1 = require("@tradle/constants");
const authorIndex = {
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
const typeIndex = {
    hashKey: '_t',
    rangeKey: '_time',
    name: 'type',
    type: 'global',
    // expensive
    // can we get away with ProjectionType KEYS_ONLY?
    projection: {
        ProjectionType: 'INCLUDE',
        NonKeyAttributes: ['_author']
    }
};
const defaultIndexes = [authorIndex, typeIndex];
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
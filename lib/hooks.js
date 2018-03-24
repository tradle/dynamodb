"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const constants_1 = require("@tradle/constants");
exports.getControlLatestOptions = (table, method, resource) => {
    if (!resource._link) {
        throw new Error('expected "_link"');
    }
    if (method === 'create' && !resource._time) {
        throw new Error('expected "_time"');
    }
    const options = {
        ConditionExpression: Object.keys(table.primaryKeys)
            .map(keyType => `attribute_not_exists(#${keyType})`)
            .join(' and '),
        ExpressionAttributeNames: Object.keys(table.primaryKeys)
            .reduce((names, keyType) => {
            names[`#${keyType}`] = table.primaryKeys[keyType];
            return names;
        }, {}),
        ExpressionAttributeValues: {
            ':link': resource._link
        }
    };
    options.ConditionExpression = `(${options.ConditionExpression}) OR #link = :link`;
    options.ExpressionAttributeNames['#link'] = '_link';
    if (resource._time) {
        options.ConditionExpression += ' OR #time < :time';
        options.ExpressionAttributeNames['#time'] = '_time';
        options.ExpressionAttributeValues[':time'] = resource._time;
    }
    return options;
};
exports.createControlLatestHook = (table, method) => {
    const latestIsSupported = !!table.deriveProperties({
        [constants_1.TYPE]: 'a',
        _permalink: 'b'
    })[table.hashKey];
    return ({ args }) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        if (!latestIsSupported)
            return;
        let [resource, options] = args;
        if (!options) {
            args[1] = exports.getControlLatestOptions(table, method, resource);
        }
    });
};
//# sourceMappingURL=hooks.js.map
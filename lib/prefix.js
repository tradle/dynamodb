"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const constants_1 = require("./constants");
const utils_1 = require("./utils");
function getUniquePrefix(type) {
    return utils_1.sha256(type).slice(0, 6);
}
exports.getUniquePrefix = getUniquePrefix;
function prefixKeys(obj, prefix, skip = []) {
    const prefixed = {};
    for (let key in obj) {
        if (skip.includes(key)) {
            prefixed[key] = obj[key];
        }
        else {
            prefixed[prefixString(key, prefix)] = obj[key];
        }
    }
    return prefixed;
}
exports.prefixKeys = prefixKeys;
function prefixValues(obj, prefix, skip = []) {
    const prefixed = {};
    for (let key in obj) {
        if (skip.includes(key)) {
            prefixed[key] = obj[key];
        }
        else {
            prefixed[key] = prefixString(obj[key], prefix);
        }
    }
    return prefixed;
}
exports.prefixValues = prefixValues;
function unprefixKeys(obj, prefix, skip = []) {
    const unprefixed = {};
    for (let key in obj) {
        if (skip.includes(key)) {
            unprefixed[key] = obj[key];
        }
        else {
            unprefixed[unprefixString(key, prefix)] = obj[key];
        }
    }
    return unprefixed;
}
exports.unprefixKeys = unprefixKeys;
function prefixString(str, prefix) {
    return prefix + constants_1.separator + str;
}
exports.prefixString = prefixString;
function unprefixString(str, prefix) {
    const start = prefix + constants_1.separator;
    if (!str.startsWith(start)) {
        throw new Error(`expected string "${str}" to start with ${start}`);
    }
    return str.slice(start.length);
}
exports.unprefixString = unprefixString;
//# sourceMappingURL=prefix.js.map
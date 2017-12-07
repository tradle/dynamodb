"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const { TYPE } = require('@tradle/constants');
const { pick, shallowClone, debug, getIndexes } = require('./utils');
const { minifiedFlag } = require('./constants');
const MINIFY_PREFERENCES = [
    {
        filter: stripBigValues,
        getProperties: obj => Object.keys(obj).sort((a, b) => {
            return byteLength(obj[b]) - byteLength(obj[a]);
        })
    },
    {
        filter: stripOptional
    },
    {
        filter: stripAll
    }
];
function minify({ table, item, maxSize }) {
    if (!maxSize || maxSize === Infinity) {
        return { min: item, diff: {} };
    }
    const { indexes } = table;
    let min = shallowClone(item);
    let diff = {};
    const model = table.models[item[TYPE]];
    let size = byteLength(min);
    for (const pref of MINIFY_PREFERENCES) {
        // approximation
        if (size < maxSize)
            break;
        const { getProperties, filter } = pref;
        let slimmed;
        let currentCut = (min[minifiedFlag] || []).slice();
        const props = getProperties ? getProperties(min) : Object.keys(min);
        for (const propertyName of props) {
            if (size < maxSize)
                break;
            if (propertyName.startsWith('_')) {
                continue;
            }
            const isIndexed = indexes.some(index => {
                return index.hashKey === propertyName || index.rangeKey === propertyName;
            });
            if (isIndexed)
                continue;
            const property = model.properties[propertyName];
            if (!property) {
                debug(`property "${propertyName}" not found in model "${model.id}"`);
                continue;
            }
            const keep = filter({
                model,
                propertyName,
                property,
                value: item[propertyName]
            });
            if (keep)
                continue;
            diff[propertyName] = item[propertyName];
            delete min[propertyName];
            if (!min[minifiedFlag]) {
                min[minifiedFlag] = [];
            }
            min[minifiedFlag].push(propertyName);
            const propSize = byteLength({ [propertyName]: item[propertyName] });
            size -= propSize;
        }
    }
    if (min[minifiedFlag] && min[minifiedFlag].length) {
        const cut = min[minifiedFlag];
        debug(`minified ${item[TYPE]} per max item size (${maxSize}). Removed: ${cut.join(', ')}`);
    }
    return { min, diff };
}
exports.default = minify;
function getRef(property) {
    if (property.ref)
        return property.ref;
    return property.items && property.items.ref;
}
function stripEmbeddedMedia({ value, property }) {
    if (getRef(property) === 'tradle.Photo') {
        if (value && value.url && /data:/.test(value.url)) {
            return false;
        }
    }
    return true; // don't strip
}
function stripBigValues({ value }) {
    return byteLength(value) < 100;
}
function stripOptional({ model, propertyName }) {
    return isRequired({ model, propertyName });
}
function stripAll() {
    return false;
}
function isRequired({ model, propertyName }) {
    return model.required && model.required.includes(propertyName);
}
function byteLength(val) {
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    return Buffer.byteLength(str, 'utf8');
}
//# sourceMappingURL=minify.js.map
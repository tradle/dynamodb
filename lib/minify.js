"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const clone_1 = tslib_1.__importDefault(require("lodash/clone"));
const flatMap_1 = tslib_1.__importDefault(require("lodash/flatMap"));
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
const constants_2 = require("./constants");
const MINIFY_PREFERENCES = [
    {
        filter: stripBigValues,
        getProperties: obj => Object.keys(obj).sort((a, b) => {
            return byteLength(obj[b]) - byteLength(obj[a]);
        })
    },
    {
        filter: stripOptional,
        getProperties: obj => Object.keys(obj)
    }
];
const neverStrip = (opts) => {
    const { property } = opts;
    return property.ref && property.type === 'object';
};
function minify({ table, item, maxSize }) {
    if (!maxSize || maxSize === Infinity) {
        return { min: item, diff: {} };
    }
    const { indexes, models } = table;
    let min = clone_1.default(item);
    let diff = {};
    const model = models[item[constants_1.TYPE]];
    let size = byteLength(min);
    for (const pref of MINIFY_PREFERENCES) {
        // approximation
        if (size < maxSize)
            break;
        const { getProperties, filter } = pref;
        let slimmed;
        let currentCut = (min[constants_2.minifiedFlag] || []).slice();
        const props = getProperties(min);
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
                utils_1.debug(`property "${propertyName}" not found in model "${model.id}"`);
                continue;
            }
            const keep = neverStrip({
                model,
                propertyName,
                property,
                value: item[propertyName]
            }) || filter({
                model,
                propertyName,
                property,
                value: item[propertyName]
            });
            if (keep)
                continue;
            diff[propertyName] = item[propertyName];
            delete min[propertyName];
            if (!min[constants_2.minifiedFlag]) {
                min[constants_2.minifiedFlag] = [];
            }
            min[constants_2.minifiedFlag].push(propertyName);
            const propSize = byteLength({ [propertyName]: item[propertyName] });
            size -= propSize;
        }
    }
    if (min[constants_2.minifiedFlag] && min[constants_2.minifiedFlag].length) {
        const cut = min[constants_2.minifiedFlag];
        utils_1.debug(`minified ${item[constants_1.TYPE]} per max item size (${maxSize}). Removed: ${cut.join(', ')}`);
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
    const { required = [] } = model;
    if (required.includes(propertyName))
        return true;
    if (model.primaryKeys) {
        return flatMap_1.default(utils_1.normalizeIndexedPropertyTemplateSchema(model.primaryKeys), ({ template }) => utils_1.getTemplateStringVariables(template))
            .includes(propertyName);
    }
}
function byteLength(val) {
    const str = typeof val === 'string' ? val : JSON.stringify(val);
    return Buffer.byteLength(str, 'utf8');
}
//# sourceMappingURL=minify.js.map
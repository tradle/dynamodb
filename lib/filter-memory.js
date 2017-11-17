"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const dotProp = require("dot-prop");
const validateResource = require("@tradle/validate-resource");
const constants_1 = require("@tradle/constants");
const OPERATORS = require("./operators");
const { getRef } = validateResource.utils;
const utils_1 = require("./utils");
const object_model_1 = require("./object-model");
const comparators = {
    EQ: isEqual,
    NEQ: negate(isEqual),
    IN: ({ value, condition }) => condition.some(one => utils_1.deepEqual(one, value)),
    NOT_IN: ({ value, condition }) => condition.every(one => !utils_1.deepEqual(one, value)),
    STARTS_WITH: ({ value, condition }) => value && value.startsWith(condition),
    CONTAINS: ({ value, condition }) => value && value.indexOf(condition) !== -1,
    NOT_CONTAINS: ({ value, condition }) => !value || value.indexOf(condition) === -1,
    BETWEEN: ({ value, condition }) => value >= condition[0] && value < condition[1],
    LT: ({ value, condition }) => value < condition,
    LTE: ({ value, condition }) => value <= condition,
    GT: ({ value, condition }) => value > condition,
    GTE: ({ value, condition }) => value >= condition,
    NULL: ({ value, condition }) => condition ? !value : !!value,
};
exports.comparators = comparators;
// function matchesProps ({ model, object, values }) {
//   return Object.keys(values).every(propertyName => {
//     const property = model.properties[propertyName]
//     return isEqual({
//       model,
//       propertyName,
//       property,
//       expected: object[propertyName],
//       value: values[propertyName]
//     })
//   })
// }
function isEqual({ models, property, condition, value }) {
    const type = property && property.type;
    if (type !== 'array' && type !== 'object') {
        return utils_1.deepEqual(condition, value);
    }
    const ref = getRef(property);
    if (property.inlined || (ref && models[ref].inlined)) {
        return utils_1.deepEqual(condition, value);
    }
    if (type === 'array') {
        utils_1.debug(`not comparing array valued search property`);
        return false;
    }
    const metadata = utils_1.fromResourceStub(condition);
    return metadata.link === value;
}
exports.isEqual = isEqual;
function matchesFilter({ models, model, object, filter }) {
    if (!filter)
        return true;
    if (!model)
        model = models[object[constants_1.TYPE]];
    for (let op in filter) {
        if (!(op in comparators)) {
            throw new Error(`operator "${op}" not supported (yet)`);
        }
        let compare = comparators[op];
        let conditions = filter[op];
        for (let propertyName in conditions) {
            if (propertyName in OPERATORS) {
                utils_1.debug('nested operators not support (yet)');
                continue;
            }
            let property = model.properties[propertyName];
            let isMatch = compare({
                models,
                model,
                propertyName,
                property,
                condition: conditions[propertyName],
                value: dotProp.get(object, propertyName)
            });
            if (!isMatch)
                return false;
        }
    }
    return true;
}
function filterResults({ models, model, results, filter }) {
    if (!filter || !Object.keys(filter).length) {
        return results;
    }
    return results.filter(object => {
        return matchesFilter({ models, model, object, filter });
    });
}
exports.filterResults = filterResults;
function isHeaderProperty(propertyName) {
    return propertyName in object_model_1.default.properties;
}
function negate(fn) {
    return function (...args) {
        return !fn.apply(this, args);
    };
}
//# sourceMappingURL=filter-memory.js.map
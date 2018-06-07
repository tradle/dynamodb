"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const _ = require("lodash");
const validateResource = require("@tradle/validate-resource");
const constants_1 = require("@tradle/constants");
const errors_1 = tslib_1.__importDefault(require("@tradle/errors"));
const OPERATORS = require("./operators");
const { getRef, isDescendantOf } = validateResource.utils;
const object_model_1 = tslib_1.__importDefault(require("./object-model"));
const defaults_1 = require("./defaults");
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
const isHeaderProperty = (propertyName) => {
    return propertyName in object_model_1.default.properties;
};
const negate = (fn) => {
    return function (...args) {
        return !fn.apply(this, args);
    };
};
exports.isEqual = ({ models, property, condition, value }) => {
    if (shouldCompareWithDeepEqual({ models, property })) {
        return _.isEqual(condition, value);
    }
    const type = property && property.type;
    if (type === 'array') {
        defaults_1.logger.debug(`not comparing array valued search property`);
        return false;
    }
    return condition._link === value;
};
const shouldCompareWithDeepEqual = ({ models, property }) => {
    const type = property && property.type;
    // primitive
    if (type !== 'array' && type !== 'object')
        return true;
    // schema-less
    if (property.range === 'json')
        return true;
    const ref = getRef(property);
    return property.inlined || (ref && models[ref].inlined);
};
exports.matchesFilter = ({ models, model, object, filter }) => {
    if (!filter)
        return true;
    if (!model)
        model = models[object[constants_1.TYPE]];
    for (let op in filter) {
        if (!(op in exports.comparators)) {
            throw new Error(`operator "${op}" not supported (yet)`);
        }
        let compare = exports.comparators[op];
        let conditions = filter[op];
        for (let propertyName in conditions) {
            if (propertyName in OPERATORS) {
                defaults_1.logger.debug('nested operators not support (yet)');
                continue;
            }
            let property = model.properties[propertyName];
            let isMatch = compare({
                models,
                model,
                propertyName,
                property,
                condition: conditions[propertyName],
                value: _.get(object, propertyName)
            });
            if (!isMatch)
                return false;
        }
    }
    return true;
};
exports.filterResults = ({ models, model, results, filter }) => {
    if (!filter || !Object.keys(filter).length) {
        return results;
    }
    return results.filter(object => {
        return exports.matchesFilter({ models, model, object, filter });
    });
};
exports.comparators = {
    EQ: exports.isEqual,
    NEQ: negate(exports.isEqual),
    IN: ({ value, condition }) => condition.some(one => _.isEqual(one, value)),
    NOT_IN: ({ value, condition }) => condition.every(one => !_.isEqual(one, value)),
    STARTS_WITH: ({ value, condition }) => value && value.startsWith(condition),
    CONTAINS: ({ value, condition }) => value && value.indexOf(condition) !== -1,
    NOT_CONTAINS: ({ value, condition }) => !value || value.indexOf(condition) === -1,
    BETWEEN: ({ value, condition }) => value >= condition[0] && value < condition[1],
    LT: ({ value, condition }) => value < condition,
    LTE: ({ value, condition }) => value <= condition,
    GT: ({ value, condition }) => value > condition,
    GTE: ({ value, condition }) => value >= condition,
    NULL: ({ value, condition }) => condition ? !value : !!value,
    SUBCLASS_OF: ({ models, value, condition }) => {
        try {
            return condition.some(b => isDescendantOf({
                models,
                a: value,
                b
            }));
        }
        catch (err) {
            errors_1.default.rethrow(err, 'developer');
            return false;
        }
    }
};
//# sourceMappingURL=filter-memory.js.map
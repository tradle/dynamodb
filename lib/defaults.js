"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
exports.primaryKeys = {
    // default for all tradle.Object resources
    hashKey: 'tradle.Object_{{_permalink}}',
    rangeKey: '_' // constant
};
exports.indexes = [
    {
        // default for all tradle.Object resources
        hashKey: 'tradle.Object_{{_author}}',
        rangeKey: '{{_time}}'
    },
    {
        // default for all tradle.Object resources
        hashKey: 'tradle.Object_{{_t}}',
        rangeKey: '{{_time}}'
    }
];
exports.getIndexesForModel = ({ table, model }) => {
    return model.indexes || exports.indexes;
};
exports.getPrimaryKeysForModel = ({ table, model }) => {
    return model.primaryKeys || exports.primaryKeys;
};
exports.resolveOrderBy = ({ table, type, hashKey, property }) => {
    const index = table.indexed.find(index => index.hashKey === hashKey);
    const model = table.models[type];
    const indexes = table.getKeyTemplatesForModel(model);
    const indexedProp = indexes[table.indexed.indexOf(index)];
    if (!(indexedProp && indexedProp.rangeKey))
        return;
    const rangeKeyDerivesFromProp = utils_1.canRenderTemplate(indexedProp.rangeKey, { [property]: 'placeholder' });
    if (rangeKeyDerivesFromProp) {
        return index.rangeKey;
    }
};
exports.deriveProperties = ({ table, item, isRead }) => {
    const type = item[constants_1.TYPE];
    const model = table.models[type];
    const indexes = table.getKeyTemplatesForModel(model);
    return _.chain(indexes)
        .map((templates, i) => {
        const { hashKey, rangeKey } = table.indexed[i];
        const ret = [{
                property: hashKey,
                template: templates.hashKey
            }];
        if (rangeKey && templates.rangeKey) {
            ret.push({
                property: rangeKey,
                template: templates.rangeKey
            });
        }
        return ret;
    })
        .flatten()
        .filter(({ template }) => utils_1.canRenderTemplate(template, item))
        .reduce((inputs, { property, template }) => {
        inputs[property] = utils_1.renderTemplate(template, item);
        return inputs;
    }, {})
        .value();
};
//# sourceMappingURL=defaults.js.map
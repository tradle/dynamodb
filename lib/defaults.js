"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
const constants_2 = require("./constants");
exports.primaryKeys = {
    // default for all tradle.Object resources
    hashKey: '_permalink',
    rangeKey: {
        template: '_' // constant
    }
};
exports.indexes = [
    {
        // default for all tradle.Object resources
        hashKey: '_author',
        rangeKey: '_time'
    },
    {
        // default for all tradle.Object resources
        hashKey: '_t',
        rangeKey: '_time'
    }
];
exports.getIndexesForModel = ({ table, model }) => {
    return (model.indexes || exports.indexes).map(utils_1.normalizeIndexedProperty);
};
exports.getPrimaryKeysForModel = ({ table, model }) => {
    return utils_1.normalizeIndexedProperty(model.primaryKeys || exports.primaryKeys);
};
exports.resolveOrderBy = ({ table, type, hashKey, property }) => {
    const index = table.indexed.find(index => index.hashKey === hashKey);
    const model = table.models[type];
    if (!model)
        return;
    const indexes = table.getKeyTemplatesForModel(model);
    const indexedProp = indexes[table.indexed.indexOf(index)];
    if (!(indexedProp && indexedProp.rangeKey))
        return;
    const rangeKeyDerivesFromProp = utils_1.canRenderTemplate(indexedProp.rangeKey.template, { [property]: 'placeholder' });
    if (rangeKeyDerivesFromProp) {
        return index.rangeKey;
    }
};
exports.deriveProperties = ({ table, item, isRead }) => {
    const type = item[constants_1.TYPE];
    const model = table.models[type];
    const indexes = table.getKeyTemplatesForModel(model);
    const renderable = _.chain(indexes)
        .map((templates, i) => {
        const { hashKey, rangeKey } = table.indexed[i];
        const ret = [{
                property: hashKey,
                template: [
                    type,
                    templates.hashKey.template
                ].join(constants_2.separator)
            }];
        if (rangeKey) {
            ret.push({
                property: rangeKey,
                template: templates.rangeKey ? templates.rangeKey.template : constants_2.RANGE_KEY_PLACEHOLDER_VALUE
            });
        }
        return ret;
    })
        .flatten()
        .filter(({ template }) => utils_1.canRenderTemplate(template, item))
        .value();
    return renderable.reduce((inputs, { property, template, sort }) => {
        inputs[property] = utils_1.renderTemplate(template, item);
        return inputs;
    }, {});
};
//# sourceMappingURL=defaults.js.map
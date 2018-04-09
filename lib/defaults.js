"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
}
Object.defineProperty(exports, "__esModule", { value: true });
const lodash_1 = __importDefault(require("lodash"));
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
    return (model.indexes || exports.indexes).map(index => utils_1.normalizeIndexedPropertyTemplateSchema(index));
};
exports.getPrimaryKeysForModel = ({ table, model }) => {
    return utils_1.normalizeIndexedPropertyTemplateSchema(model.primaryKeys || exports.primaryKeys);
};
exports.resolveOrderBy = ({ table, type, hashKey, property }) => {
    const model = table.models[type];
    if (!model)
        return;
    const index = table.indexed.find(index => index.hashKey === hashKey);
    const indexes = table.getKeyTemplatesForModel(model);
    const indexedProp = indexes[table.indexed.indexOf(index)];
    if (!(indexedProp && indexedProp.rangeKey))
        return;
    const rangeKeyDerivesFromProp = utils_1.canRenderTemplate(indexedProp.rangeKey.template, { [property]: 'placeholder' });
    if (rangeKeyDerivesFromProp) {
        return index.rangeKey;
    }
};
exports.deriveProps = ({ table, item, isRead }) => {
    // expand '.' props
    item = expandNestedProps(item);
    let rType = item[constants_1.TYPE];
    if (!rType) {
        const { hashKey } = table.indexed.find(i => i.hashKey in item);
        if (!hashKey) {
            throw new Error('unable to deduce resource type');
        }
        rType = item[hashKey].split(constants_2.separator)[0]; // see template below
    }
    const model = table.models[rType];
    const indexes = table.getKeyTemplatesForModel(model);
    const renderable = lodash_1.default.chain(indexes)
        .map((templates, i) => {
        const { hashKey, rangeKey } = table.indexed[i];
        const ret = [{
                property: hashKey,
                template: [
                    rType,
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
exports.parseDerivedProps = ({ table, model, resource }) => {
    const templates = lodash_1.default.chain(table.getKeyTemplatesForModel(model))
        .flatMap(({ hashKey, rangeKey }) => {
        return [
            Object.assign({}, hashKey, { type: 'hash' }),
            rangeKey && Object.assign({}, rangeKey, { type: 'range' })
        ];
    })
        .filter(lodash_1.default.identity)
        .filter(info => /^[{]{2}[^}]+[}]{2}$/.test(info.template))
        .value();
    const derived = lodash_1.default.pick(resource, table.derivedProps);
    const yay = {};
    const properties = utils_1.getExpandedProperties(model);
    return lodash_1.default.transform(derived, (parsed, value, prop) => {
        const info = templates.find(({ key }) => key === prop);
        if (!info)
            return;
        const { key, template, type } = info;
        let propVal = value;
        if (type === 'hash') {
            propVal = propVal.slice(model.id.length + 2);
        }
        const propName = utils_1.getTemplateStringVariables(template)[0];
        const propMeta = properties[propName];
        if (!propMeta)
            return;
        const pType = propMeta.type;
        // complex props not supported at the moment
        if (pType === 'array' || pType === 'object')
            return;
        if (pType === 'number' || pType === 'date') {
            propVal = parseInt(propVal, 10);
        }
        else if (pType === 'boolean') {
            propVal = propVal === 'true' || propVal === '1';
        }
        parsed[propName] = propVal;
    }, {});
};
const expandNestedProps = obj => {
    const expanded = {};
    for (let key in obj) {
        lodash_1.default.set(expanded, key, obj[key]);
    }
    return expanded;
};
//# sourceMappingURL=defaults.js.map
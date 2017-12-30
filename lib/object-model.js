"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const models_1 = require("@tradle/models");
const constants_1 = require("./constants");
const BaseObjectModel = models_1.models['tradle.Object'];
const copy = _.cloneDeep(BaseObjectModel);
copy.properties[constants_1.typeAndPermalinkProperty] = {
    type: 'string',
    virtual: true
};
copy.properties._dateModified = {
    type: 'number',
    virtual: true
};
exports.default = copy;
//# sourceMappingURL=object-model.js.map
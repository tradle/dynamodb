"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const clone = require("clone");
const BaseObjectModel = require('@tradle/models')['tradle.Object'];
const copy = clone(BaseObjectModel);
const { typeAndPermalinkProperty } = require('./constants');
copy.properties[typeAndPermalinkProperty] = {
    type: 'string',
    virtual: true
};
copy.properties._dateModified = {
    type: 'number',
    virtual: true
};
exports.default = copy;
//# sourceMappingURL=object-model.js.map
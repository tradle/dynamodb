"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const cloneDeep_1 = tslib_1.__importDefault(require("lodash/cloneDeep"));
const models_1 = require("@tradle/models");
// import { typeAndPermalinkProperty } from './constants'
const BaseObjectModel = models_1.models['tradle.Object'];
const copy = cloneDeep_1.default(BaseObjectModel);
// copy.properties[typeAndPermalinkProperty] = {
//   type: 'string',
//   virtual: true
// }
copy.properties._dateModified = {
    type: 'number',
    virtual: true
};
exports.default = copy;
//# sourceMappingURL=object-model.js.map
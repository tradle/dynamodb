"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const omit_1 = tslib_1.__importDefault(require("lodash/omit"));
const events_1 = require("events");
const merge_models_1 = tslib_1.__importDefault(require("@tradle/merge-models"));
const promiseNoop = () => tslib_1.__awaiter(this, void 0, void 0, function* () { });
class ModelStore extends events_1.EventEmitter {
    constructor({ models = {}, onMissingModel = promiseNoop }) {
        super();
        this.get = (id) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            let model = this.models[id];
            if (!model) {
                yield this.onMissingModel(id);
                model = this.models[id];
            }
            if (!model)
                throw new Error(`model not found: ${id}`);
            return model;
        });
        this.addModel = (model) => {
            this.addModels({ [model.id]: model });
        };
        this.addModels = (models) => {
            this.models = merge_models_1.default()
                .add(this.models, { validate: false })
                .add(models)
                .get();
            this.emit('update');
        };
        this.removeModels = (models) => {
            this.models = omit_1.default(this.models, Object.keys(models));
        };
        this.models = models || {};
        this.onMissingModel = onMissingModel;
    }
}
exports.ModelStore = ModelStore;
exports.createModelStore = (opts) => new ModelStore(opts);
//# sourceMappingURL=model-store.js.map
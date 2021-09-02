"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const events_1 = require("events");
const mergeModels = require("@tradle/merge-models");
const promiseNoop = async () => { };
class ModelStore extends events_1.EventEmitter {
    constructor({ models = {}, onMissingModel = promiseNoop }) {
        super();
        this.get = async (id) => {
            let model = this.models[id];
            if (!model) {
                await this.onMissingModel(id);
                model = this.models[id];
            }
            if (!model)
                throw new Error(`model not found: ${id}`);
            return model;
        };
        this.addModel = (model) => {
            this.addModels({ [model.id]: model });
        };
        this.addModels = (models) => {
            this.models = mergeModels()
                .add(this.models, { validate: false, overwrite: true })
                .add(models)
                .get();
            this.emit('update');
        };
        this.removeModels = (models) => {
            this.models = _.omit(this.models, Object.keys(models));
        };
        this.models = models || {};
        this.onMissingModel = onMissingModel;
    }
}
exports.ModelStore = ModelStore;
exports.createModelStore = (opts) => new ModelStore(opts);
//# sourceMappingURL=model-store.js.map
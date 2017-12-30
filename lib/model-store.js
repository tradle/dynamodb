"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const _ = require("lodash");
const events_1 = require("events");
const mergeModels = require("@tradle/merge-models");
const promiseNoop = () => __awaiter(this, void 0, void 0, function* () { });
class ModelStore extends events_1.EventEmitter {
    constructor({ models = {}, onMissingModel = promiseNoop }) {
        super();
        this.get = (id) => __awaiter(this, void 0, void 0, function* () {
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
            this.models = mergeModels()
                .add(this.models, { validate: false })
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
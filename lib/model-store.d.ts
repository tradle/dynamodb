import { EventEmitter } from 'events';
import { Model, Models } from './types';
export declare type OnMissingModelPromiser = (id: string) => Promise<void>;
export declare class ModelStore extends EventEmitter {
    models: Models;
    private onMissingModel;
    constructor({models, onMissingModel}: {
        models?: Models;
        onMissingModel?: OnMissingModelPromiser;
    });
    get: (id: string) => Promise<Model>;
    addModel: (model: Model) => void;
    addModels: (models: Models) => void;
    removeModels: (models: Models) => void;
}
export declare const createModelStore: (opts: any) => ModelStore;

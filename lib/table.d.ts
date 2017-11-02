/// <reference types="node" />
import { EventEmitter } from 'events';
import { DynogelIndex, KeyProps, ITableOpts, BackoffOptions, Objects, Model, Models, FindOpts } from './types';
export default class Table extends EventEmitter {
    name: string;
    models: Models;
    objects: Objects;
    model?: Model;
    primaryKeyProps: string[];
    primaryKeys: KeyProps;
    indexes: DynogelIndex[];
    private opts;
    private modelsStored;
    private _prefix;
    private tableDefinition;
    private table;
    private exclusive;
    private readOnly;
    private findOpts;
    readonly hashKey: string;
    readonly rangeKey: string;
    constructor(name: any, opts: ITableOpts);
    inflate: (resource: any) => Promise<any>;
    addModel: ({model, indexes}: {
        model: Model;
        indexes?: DynogelIndex[];
    }) => void;
    get: (query: any, opts?: {}) => Promise<any>;
    latest: (query: any, opts?: {}) => Promise<any>;
    del: (query: any, opts?: {}) => Promise<any>;
    private _exportResource;
    batchPut: (resources: any[], backoffOpts?: BackoffOptions) => Promise<any[]>;
    put: (resource: any) => Promise<void>;
    update: (resource: any) => Promise<void>;
    merge: (resource: any) => Promise<void>;
    find: (opts: FindOpts) => Promise<{
        items: any;
        startPosition: any;
        endPosition: any;
        index: DynogelIndex;
        itemToPosition: Function;
    }>;
    search: (...args: any[]) => any;
    getPrefix: (type: any) => string;
    create: () => Promise<void>;
    destroy: () => Promise<void>;
    private _debug;
    private _defineTable;
    toDBFormat: (resource: any) => any;
    fromDBFormat: (resource: any) => any;
    prefixKey: ({type, key}: {
        type: string;
        key: string;
    }) => string;
    prefixProperties: (resource: any) => any;
    prefixPropertiesForType: (type: string, properties: any) => any;
    unprefixProperties: (resource: any) => any;
    unprefixPropertiesForType: (type: string, resource: any) => any;
    private _wrapDBOperation;
    private _maybeInflate;
    private _write;
    private _validateResource;
    private _batchPut;
    private getPrimaryKeys;
    calcTypeAndPermalinkProperty: (resource: any) => string;
    private _ensureWritable;
}

/// <reference types="node" />
import { EventEmitter } from 'events';
import { IDynogelIndex, KeyProps, ITableOpts, BackoffOptions, Objects, Model, Models, FindOpts } from './types';
export declare class Table extends EventEmitter {
    name: string;
    models: Models;
    objects?: Objects;
    model?: Model;
    primaryKeyProps: string[];
    keyProps: string[];
    hashKeyProps: string[];
    primaryKeys: KeyProps;
    derivedProperties: string[];
    indexes: IDynogelIndex[];
    indexed: IDynogelIndex[];
    exclusive: boolean;
    table: any;
    private opts;
    private modelsStored;
    private _prefix;
    private tableDefinition;
    private readOnly;
    private findOpts;
    private _deriveProperties;
    private _resolveOrderBy;
    private _getIndexesForModel;
    private _getPrimaryKeysForModel;
    private _shouldMinify;
    private hooks;
    readonly hashKey: string;
    readonly rangeKey: string;
    constructor(opts: ITableOpts);
    getKeyTemplatesForModel: (model: Model) => {
        hashKey: {
            template: string;
        };
        rangeKey?: {
            template: string;
        };
    }[];
    hook: (method: any, handler: any) => any;
    storeResourcesForModels: (models: Models) => any;
    storeResourcesForModel: ({ model }: {
        model: Model;
    }) => void;
    get: (query: any, opts?: {}) => Promise<any>;
    del: (query: any, opts?: {}) => Promise<any>;
    private _exportResource;
    batchPut: (resources: any[], backoffOpts?: BackoffOptions) => Promise<any[]>;
    put: (resource: any, opts?: any) => Promise<void>;
    update: (resource: any, opts?: any) => Promise<any>;
    merge: (resource: any, opts: any) => Promise<any>;
    find: (opts: FindOpts) => Promise<any>;
    findOne: (opts: any) => Promise<any>;
    search: (opts: any) => Promise<any>;
    getPrefix: (type: any) => string;
    create: () => Promise<void>;
    destroy: () => Promise<void>;
    private _debug;
    private _initTable;
    deriveProperties: (item: any, isRead?: boolean) => any;
    toDBFormat: (resource: any) => any;
    fromDBFormat: (items: any) => any;
    private _write;
    private _validateResource;
    private _batchPut;
    getPrimaryKeys: (resource: any) => any;
    addDerivedProperties: (resource: any, forRead: any) => any;
    withDerivedProperties: (resource: any) => any;
    omitDerivedProperties: (resource: any) => any;
    resolveOrderBy: (opts: {
        type: string;
        hashKey: string;
        property: string;
        table?: Table;
    }) => string;
    private _ensureWritable;
    private _ensureHasPrimaryKeys;
    private _hasAllPrimaryKeys;
    private _minify;
}
export declare const createTable: (opts: ITableOpts) => Table;

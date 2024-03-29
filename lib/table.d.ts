/// <reference types="node" />
import { EventEmitter } from 'events';
import { IDynogelIndex, KeyProps, ITableOpts, BackoffOptions, Objects, Model, Models, FindOpts, DerivedPropsParser, ILogger, SearchResult, ReindexOpts } from './types';
interface ResolveOrderByInputLite {
    type: string;
    hashKey: string;
    property: string;
    item?: any;
    table?: Table;
}
export declare class Table extends EventEmitter {
    name: string;
    models: Models;
    objects?: Objects;
    model?: Model;
    primaryKeyProps: string[];
    keyProps: string[];
    hashKeyProps: string[];
    primaryKeys: KeyProps;
    derivedProps: string[];
    parseDerivedProps: DerivedPropsParser;
    indexes: IDynogelIndex[];
    indexed: IDynogelIndex[];
    exclusive: boolean;
    table: any;
    logger: ILogger;
    private opts;
    private modelsStored;
    private _prefix;
    private tableDefinition;
    private readOnly;
    private findOpts;
    private _deriveProps;
    private _resolveOrderBy;
    private _getIndexesForModel;
    private _getPrimaryKeysForModel;
    private _shouldMinify;
    private hooks;
    get hashKey(): string;
    get rangeKey(): string;
    constructor(opts: ITableOpts);
    getKeyTemplate: (model: Model, key: string) => any;
    getKeyTemplatesForModel: (model: Model) => {
        hashKey: {
            key: string;
            template: string;
        };
        rangeKey: {
            key: string;
            template: string;
        };
        specificity?: number;
    }[];
    getIndexesForModel: (model: Model) => import("./types").IndexedProperty[];
    getIndexesForType: (type: string) => import("./types").IndexedProperty[];
    getPrimaryKeysForModel: (model: Model) => import("./types").IndexedProperty;
    getPrimaryKeysForType: (type: string) => import("./types").IndexedProperty;
    hook: (method: any, handler: any) => any;
    storeResourcesForModels: (models: Models) => any;
    storeResourcesForModel: ({ model }: {
        model: Model;
    }) => void;
    get: (query: any, opts?: any) => Promise<any>;
    del: (query: any, opts?: any) => Promise<any>;
    private _exportResource;
    batchPut: (resources: any[], backoffOpts?: BackoffOptions) => Promise<any[]>;
    put: (resource: any, opts?: any) => Promise<void>;
    update: (resource: any, opts?: any) => Promise<any>;
    merge: (resource: any, opts: any) => Promise<any>;
    find: (_opts: FindOpts) => Promise<SearchResult>;
    findOne: (opts: FindOpts) => Promise<any>;
    matchOne: (type: string, props: any) => Promise<any>;
    search: (opts: FindOpts) => Promise<SearchResult>;
    list: (type: string, opts?: Partial<FindOpts>) => Promise<SearchResult>;
    getPrefix: (type: any) => string;
    create: () => Promise<void>;
    destroy: (opts?: {
        throwOnNotFound: boolean;
    }) => Promise<void>;
    exists: () => Promise<boolean>;
    private _describeTable;
    private _awaitExists;
    private _initTable;
    deriveProps: (opts: {
        item: any;
        isRead?: boolean;
        noConstants?: boolean;
        renderPrefix?: boolean;
    }) => any;
    toDBFormat: (resource: any) => any;
    fromDBFormat: (items: any) => any;
    private _write;
    private _validateResource;
    private _batchPut;
    getPrimaryKeys: (resource: any) => any;
    getKeys: (resource: any, schema: KeyProps) => any;
    addDerivedProperties: (item: any, isRead: any) => any;
    withDerivedProperties: (item: any) => any;
    omitDerivedProperties: (item: any) => any;
    resolveOrderBy: (opts: ResolveOrderByInputLite) => import("./types").ResolvedOrderBy;
    reindex: ({ model, batchSize, findOpts }: ReindexOpts) => Promise<{
        updated: number;
        unchanged: number;
    }>;
    haveIndexedPropsChanged: (item: any) => boolean;
    private _ensureWritable;
    private _ensureHasPrimaryKeys;
    private _hasAllPrimaryKeys;
    private _hasAllKeys;
    private _minify;
    private _getModel;
}
export declare const createTable: (opts: ITableOpts) => Table;
export {};

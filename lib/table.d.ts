/// <reference types="node" />
import { EventEmitter } from 'events';
import { DynogelTableDefinition, KeyProps, ITableOpts, BackoffOptions, Objects, Model, Models, FindOpts } from './types';
export default class Table extends EventEmitter {
    name: string;
    models: Models;
    objects?: Objects;
    model?: Model;
    primaryKeyProps: string[];
    primaryKeys: KeyProps;
    indexes: AWS.DynamoDB.Types.GlobalSecondaryIndex;
    exclusive: boolean;
    table: any;
    schema: AWS.DynamoDB.Types.TableDescription;
    tableDefinition: DynogelTableDefinition;
    private opts;
    private modelsStored;
    private _prefix;
    private readOnly;
    private findOpts;
    readonly hashKey: string;
    readonly rangeKey: string;
    constructor(opts: ITableOpts);
    addModel: ({model}: {
        model: Model;
    }) => void;
    get: (query: any, opts?: {}) => Promise<any>;
    latest: (query: any, opts?: {}) => Promise<any>;
    del: (query: any, opts?: {}) => Promise<any>;
    private _exportResource;
    batchPut: (resources: any[], backoffOpts?: BackoffOptions) => Promise<any[]>;
    put: (resource: any, opts?: any) => Promise<void>;
    update: (resource: any, opts?: any) => Promise<void>;
    merge: (resource: any) => Promise<void>;
    find: (opts: FindOpts) => Promise<{
        items: any[];
        startPosition: any;
        endPosition: any;
        index: any;
        itemToPosition: Function;
    }>;
    findOne: (opts: any) => Promise<any>;
    search: (...args: any[]) => any;
    getPrefix: (type: any) => string;
    create: () => Promise<void>;
    destroy: () => Promise<void>;
    private _debug;
    private _initTable;
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
    private _write;
    private _validateResource;
    private _batchPut;
    private getPrimaryKeys;
    calcTypeAndPermalinkProperty: (resource: any) => string;
    private _ensureWritable;
}
export declare const createTable: (opts: ITableOpts) => Table;

/// <reference types="node" />
import { EventEmitter } from 'events';
import { Table } from './table';
import { ModelStore } from './model-store';
import { IDBOpts, Model, Models, FindOpts, ILogger, SearchResult, ReindexOpts } from './types';
export default class DB extends EventEmitter {
    static getSafeTableName: (model: any) => string;
    modelStore: ModelStore;
    tablesByName: {
        [key: string]: Table;
    };
    tables: {
        [key: string]: Table;
    };
    exclusive: {
        [key: string]: Table;
    };
    logger: ILogger;
    private tableTableNames;
    private _choose;
    private _instantiateTable;
    private hooks;
    constructor({tableNames, defineTable, chooseTable, modelStore, logger}: IDBOpts);
    readonly models: Models;
    setExclusive: ({ model, table }: {
        model?: any;
        table: Table;
    }) => void;
    choose: (type: string) => Promise<Table>;
    put: (resource: any, opts?: any) => Promise<void>;
    update: (resource: any, opts?: any) => Promise<any>;
    merge: (resource: any, opts?: any) => Promise<any>;
    get: (keys: any, opts?: any) => Promise<any>;
    del: (keys: any, opts?: any) => Promise<any>;
    getTableForType: (type: string) => Promise<Table>;
    getTableForModel: (model: Model) => Table;
    batchPut: (resources: any[], opts?: any) => Promise<void | any[]>;
    find: (opts: FindOpts) => Promise<SearchResult>;
    findOne: (opts: any) => Promise<any>;
    search: (opts: any) => Promise<SearchResult>;
    list: (type: string, opts?: Partial<FindOpts>) => Promise<SearchResult>;
    reindex: (opts: ReindexOpts) => Promise<{
        updated: number;
        unchanged: number;
    }>;
    createTables: () => Promise<void>;
    destroyTables: () => Promise<void>;
    hook: (method: any, handler: any) => any;
    private createTable;
    private destroyTable;
    private _getTablesNames;
    private _chooseTableForModel;
}

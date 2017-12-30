/// <reference types="node" />
import { EventEmitter } from 'events';
import Table from './table';
import { IDBOpts, Models, FindOpts } from './types';
export default class DB extends EventEmitter {
    static getSafeTableName: (model: any) => string;
    models: any;
    tablesByName: {
        [key: string]: Table;
    };
    tables: {
        [key: string]: Table;
    };
    exclusive: {
        [key: string]: Table;
    };
    private tableTableNames;
    private _choose;
    private _instantiateTable;
    constructor({models, tableNames, defineTable, chooseTable}: IDBOpts);
    setExclusive: ({model, table}: {
        model?: any;
        table: Table;
    }) => void;
    choose: (type: string) => Table;
    put: (item: any, opts?: any) => Promise<void>;
    update: (resource: any, opts?: any) => Promise<any>;
    merge: (resource: any, opts?: any) => Promise<any>;
    get: (keys: any, opts?: any) => Promise<any>;
    latest: (keys: any, opts?: any) => Promise<any>;
    del: (keys: any) => Promise<void>;
    batchPut: (resources: any[], opts?: any) => Promise<void | any[]>;
    find: (opts: FindOpts) => Promise<any>;
    findOne: (opts: any) => Promise<any>;
    search: (opts: any) => Promise<any>;
    createTables: () => Promise<void>;
    destroyTables: () => Promise<void>;
    addModels: (models: Models) => void;
    setModels: (models: Models) => void;
    hasTableForModel: (model: any) => boolean;
    private _getTablesNames;
}

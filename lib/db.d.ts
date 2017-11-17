/// <reference types="node" />
import { EventEmitter } from 'events';
import Table from './table';
import { IDBOpts, DynogelIndex, Models, FindOpts } from './types';
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
    put: (item: any) => Promise<void>;
    update: (resource: any) => Promise<void>;
    merge: (resource: any) => Promise<void>;
    get: (keys: any) => Promise<any>;
    latest: (keys: any) => Promise<any>;
    del: (keys: any) => Promise<void>;
    batchPut: (resources: any[]) => Promise<void>;
    find: (opts: FindOpts) => Promise<{
        items: any;
        startPosition: any;
        endPosition: any;
        index: DynogelIndex;
        itemToPosition: Function;
    }>;
    findOne: (opts: any) => Promise<any>;
    search: (opts: any) => Promise<{
        items: any;
        startPosition: any;
        endPosition: any;
        index: DynogelIndex;
        itemToPosition: Function;
    }>;
    createTables: (opts: any) => Promise<void>;
    destroyTables: (opts: any) => Promise<void>;
    addModels: (models: Models) => void;
    setModels: (models: Models) => void;
    private _getTablesNames;
}

/// <reference types="node" />
import { EventEmitter } from 'events';
import Table from './table';
import { DynogelIndex, ITableOpts, Models, TableChooser, FindOpts } from './types';
export default class DB extends EventEmitter {
    models: any;
    objects: any;
    tablesByName: {
        [key: string]: Table;
    };
    tables: {
        [key: string]: Table;
    };
    exclusive: {
        [key: string]: Table;
    };
    private tableOpts;
    private tableTableNames;
    private _choose;
    constructor({tableOpts, tableNames, chooseTable}: {
        tableNames: string[];
        tableOpts: ITableOpts;
        chooseTable?: TableChooser;
    });
    setExclusive: ({name, model, opts, table}: {
        model: any;
        name?: string;
        opts?: ITableOpts;
        table?: Table;
    }) => void;
    choose: (type: string) => Table;
    put: (item: any) => Promise<void>;
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
    search: (...args: any[]) => Promise<any>;
    createTables: (opts: any) => Promise<void>;
    destroyTables: (opts: any) => Promise<void>;
    addModels: (models: Models) => void;
    setModels: (models: Models) => void;
    private _getTablesNames;
}

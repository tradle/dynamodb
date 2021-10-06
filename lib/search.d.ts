import { OrderBy, Model, Models, IDynogelIndex, FindOptsWithTable, AllowScan, SearchResult, ItemToPosition } from './types';
import { Table } from './table';
export declare class Search {
    opts: FindOptsWithTable;
    models: Models;
    model: Model;
    type: string;
    filter: any;
    expandedFilter: any;
    select?: string[];
    decisionProps: string[];
    orderBy?: OrderBy;
    defaultOrderBy?: OrderBy;
    limit: number;
    batchLimit?: number;
    checkpoint?: any;
    sortedByDB: boolean;
    queryProp: string;
    opType: string;
    itemToPosition: ItemToPosition;
    index?: IDynogelIndex;
    allowScan: AllowScan;
    bodyInObjects: boolean;
    consistentRead: boolean;
    builder: any;
    table: Table;
    constructor(opts: FindOptsWithTable);
    private _debug;
    private _normalizeSelect;
    private guessSelect;
    exec: () => Promise<SearchResult>;
    sortResults: (results: any) => any;
    collectInBatches: () => Promise<{
        ScannedCount: number;
        Items: any[];
    }>;
    _filterResults: (results: any) => any[];
    _postProcessResult: (result: any) => Promise<void>;
    _maybeInflate: (resource: any) => Promise<any>;
    get queriedPrimaryKeys(): {
        hashKey: string;
        rangeKey: string;
    };
    _addConditions: () => any;
    _configureBuilder: () => void;
    _throwIfScanForbidden: () => void;
}
export declare const search: (opts: FindOptsWithTable) => Promise<SearchResult>;
export declare const expandFilter: (table: Table, filter: any) => any;

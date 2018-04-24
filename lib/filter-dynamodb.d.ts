import { OrderBy, Model, Models, IDynogelIndex, FindOpts, AllowScan } from './types';
import { Table } from './table';
export declare class FilterOp {
    opts: FindOpts;
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
    checkpoint?: any;
    sortedByDB: boolean;
    queryProp: string;
    opType: string;
    itemToPosition: Function;
    index?: IDynogelIndex;
    allowScan: AllowScan;
    bodyInObjects: boolean;
    consistentRead: boolean;
    builder: any;
    table: Table;
    constructor(opts: FindOpts);
    private _debug;
    private _normalizeSelect;
    private guessSelect;
    exec: () => Promise<{
        items: any;
        startPosition: any;
        endPosition: any;
        index: IDynogelIndex;
        itemToPosition: Function;
    }>;
    sortResults: (results: any) => any;
    collectInBatches: () => Promise<{
        ScannedCount: number;
        Items: any[];
    }>;
    _filterResults: (results: any) => any[];
    _postProcessResult: (result: any) => Promise<void>;
    _maybeInflate: (resource: any) => Promise<any>;
    readonly queriedPrimaryKeys: {
        hashKey: string;
        rangeKey: string;
    };
    _addConditions: () => any;
    _configureBuilder: () => void;
    _throwIfScanForbidden: () => void;
}
export default function (opts: any): Promise<{
    items: any;
    startPosition: any;
    endPosition: any;
    index: IDynogelIndex;
    itemToPosition: Function;
}>;
export declare const expandFilter: (table: Table, filter: any) => any;

import { Table } from './table';
import { Model, Models, DynogelIndex, DynogelTableDefinition, OrderBy } from './types';
declare const utils: {
    fromResourceStub: (props: any) => {
        [x: number]: any;
        link: any;
        permalink: any;
    };
    sortResults: ({results, orderBy}: {
        results: any[];
        orderBy?: OrderBy;
    }) => any[];
    compare: (a: any, b: any, propertyName: any, asc: any) => 1 | -1 | 0;
    promisify: any;
    debug: any;
    bindAll: any;
    toObject: (arr: any) => {};
    getIndexes: (model: any) => DynogelIndex[];
    getTableName: ({model, prefix, suffix}: {
        model: any;
        prefix?: string;
        suffix?: string;
    }) => string;
    resultsToJson: (items: any) => any;
    getQueryInfo: ({table, filter, orderBy}: {
        table: any;
        filter: any;
        orderBy: any;
    }) => {
        opType: string;
        hashKey: any;
        rangeKey: any;
        queryProp: any;
        index: any;
        itemToPosition: (item: any) => any;
        filterProps: string[];
        sortedByDB: any;
    };
    runWithBackoffWhile: (fn: any, opts: any) => Promise<any>;
    runWithBackoffOnTableNotExists: (fn: any, opts?: {}) => Promise<any>;
    waitTillActive: (table: any) => Promise<void>;
    getModelPrimaryKeys: (model: any) => any;
    getResourcePrimaryKeys: ({model, resource}: {
        model: any;
        resource: any;
    }) => {
        hashKey: any;
    };
    minBy: <T>(arr: T[], fn: (T: any, i: number) => number) => T;
    sha256: (data: any) => string;
    wait: (millis: any) => Promise<{}>;
    defaultBackoffFunction: (retryCount: any) => number;
    validateTableName: (name: string) => void;
    getFilterType: (opts: any) => string;
    lazyDefine: (obj: any, keys: string[], definer: Function) => void;
    levenshteinDistance: (a: string, b: string) => any;
    getIndexForPrimaryKeys: ({model}: {
        model: Model;
    }) => DynogelIndex;
    getTableDefinitionForModel: ({models, model}: {
        models: Models;
        model: Model;
    }) => DynogelTableDefinition;
    getDefaultTableDefinition: ({tableName}: {
        tableName: string;
    }) => DynogelTableDefinition;
    toDynogelTableDefinition: (cloudformation: any) => DynogelTableDefinition;
    toDynogelIndexDefinition: (cloudformation: any) => DynogelIndex;
    doesIndexProjectProperty: ({table, index, property}: {
        table: Table;
        index: DynogelIndex;
        property: string;
    }) => any;
    getModelProperties: (model: any) => any[];
    uniqueStrict: (arr: any) => any[];
};
export = utils;

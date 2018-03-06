import bindAll = require('bindall');
import promisify = require('pify');
import AWS = require('aws-sdk');
import { Table } from './table';
import { Model, Models, DynogelIndex, DynogelTableDefinition, OrderBy } from './types';
declare const debug: any;
declare const levenshteinDistance: (a: string, b: string) => any;
declare function getTableName({model, prefix, suffix}: {
    model: any;
    prefix?: string;
    suffix?: string;
}): string;
declare function getIndexes(model: any): DynogelIndex[];
declare function sortResults({results, orderBy}: {
    results: any[];
    orderBy?: OrderBy;
}): any[];
declare function compare(a: any, b: any, propertyName: any, asc: any): 1 | -1 | 0;
declare function toObject(arr: any): {};
declare function fromResourceStub(props: any): {
    [x: number]: any;
    link: any;
    permalink: any;
};
declare function resultsToJson(items: any): any;
declare const getModelProperties: (model: any) => any[];
declare function getQueryInfo({table, filter, orderBy}: {
    table: any;
    filter: any;
    orderBy: any;
}): {
    opType: string;
    hashKey: any;
    rangeKey: any;
    queryProp: any;
    index: any;
    itemToPosition: (item: any) => any;
    filterProps: string[];
    sortedByDB: any;
};
declare function runWithBackoffOnTableNotExists(fn: any, opts?: any): Promise<any>;
declare const runWithBackoffWhile: (fn: any, opts: any) => Promise<any>;
declare function wait(millis: any): Promise<{}>;
declare const waitTillActive: (table: any) => Promise<void>;
declare function getModelPrimaryKeys(model: any): any;
declare function getResourcePrimaryKeys({model, resource}: {
    model: any;
    resource: any;
}): {
    hashKey: any;
};
declare function minBy<T>(arr: T[], fn: (T, i: number) => number): T;
declare function sha256(data: any): string;
declare function defaultBackoffFunction(retryCount: any): number;
declare const validateTableName: (name: string) => void;
declare const getFilterType: (opts: any) => string;
declare const lazyDefine: (obj: any, keys: string[], definer: Function) => void;
declare const getIndexForPrimaryKeys: ({ model }: {
    model: Model;
}) => DynogelIndex;
declare const getTableDefinitionForModel: ({ models, model }: {
    models: Models;
    model: Model;
}) => DynogelTableDefinition;
declare const getDefaultTableDefinition: ({ tableName }: {
    tableName: string;
}) => DynogelTableDefinition;
declare const toDynogelTableDefinition: (cloudformation: AWS.DynamoDB.CreateTableInput) => DynogelTableDefinition;
declare const toDynogelIndexDefinition: (cloudformation: AWS.DynamoDB.GlobalSecondaryIndex) => DynogelIndex;
declare const doesIndexProjectProperty: ({ table, index, property }: {
    table: Table;
    index: DynogelIndex;
    property: string;
}) => boolean;
declare const uniqueStrict: (arr: any) => any[];
export { fromResourceStub, sortResults, compare, promisify, debug, bindAll, toObject, getIndexes, getTableName, resultsToJson, getQueryInfo, runWithBackoffWhile, runWithBackoffOnTableNotExists, waitTillActive, getModelPrimaryKeys, getResourcePrimaryKeys, minBy, sha256, wait, defaultBackoffFunction, validateTableName, getFilterType, lazyDefine, levenshteinDistance, getIndexForPrimaryKeys, getTableDefinitionForModel, getDefaultTableDefinition, toDynogelTableDefinition, toDynogelIndexDefinition, doesIndexProjectProperty, getModelProperties, uniqueStrict };

import bindAll = require('bindall');
import promisify = require('pify');
import AWS = require('aws-sdk');
import { Table } from './table';
import { Model, Models, IDynogelIndex, IDynogelTableDefinition, OrderBy, FindOpts, IndexedProperty, IDynamoDBKey } from './types';
declare const debug: any;
export declare const levenshteinDistance: (a: string, b: string) => any;
export declare const getTableName: ({ model, prefix, suffix }: {
    model: any;
    prefix?: string;
    suffix?: string;
}) => string;
export declare const sortResults: ({ results, orderBy, defaultOrderBy }: {
    results: any[];
    orderBy?: OrderBy;
    defaultOrderBy?: OrderBy;
}) => any;
export declare const compare: (a: any, b: any, propertyName: any) => 1 | -1 | 0;
export declare const toObject: (arr: any) => {};
export declare const fromResourceStub: (props: any) => {
    [x: number]: any;
    link: any;
    permalink: any;
};
export declare const resultsToJson: (items: any) => any;
export declare const getUsedProperties: (filter: any) => string[];
/**
 * flattens nested filter
 *
 * has no semantic meaning, this is just to be able to check
 * which props are being filtered against
 */
export declare const flatten: (filter: any) => any[];
export declare const getModelProperties: any;
export declare const getMissingProperties: ({ resource, model, opts }: {
    resource: any;
    model: any;
    opts: FindOpts;
}) => any;
export declare const getPreferredQueryProperty: ({ table, properties }: {
    table: Table;
    properties: string[];
}) => {
    property: string;
    rangeKey?: string;
    index?: IDynogelIndex;
};
export declare const getIndexForProperty: ({ table, property }: {
    table: any;
    property: any;
}) => any;
export declare const getQueryInfo: ({ table, filter, orderBy, type }: {
    table: Table;
    filter: any;
    orderBy: any;
    type: string;
}) => {
    opType: string;
    hashKey: string;
    rangeKey: string;
    queryProp: any;
    index: any;
    itemToPosition: (item: any) => any;
    filterProps: string[];
    sortedByDB: any;
    orderBy: any;
    defaultOrderBy: any;
};
declare function runWithBackoffOnTableNotExists(fn: any, opts?: any): Promise<any>;
declare const runWithBackoffWhile: (fn: any, opts: any) => Promise<any>;
declare function wait(millis: any): Promise<{}>;
declare const waitTillActive: (table: any) => Promise<void>;
declare function minBy<T>(arr: T[], fn: (T, i: number) => number): T;
declare function sha256(data: any): string;
declare function defaultBackoffFunction(retryCount: any): number;
declare const validateTableName: (name: string) => void;
declare const getFilterType: (opts: any) => string;
export declare const lazyDefine: (obj: any, keys: string[], definer: Function) => void;
export declare const getTableDefinitionForModel: ({ models, model }: {
    models: Models;
    model: Model;
}) => IDynogelTableDefinition;
export declare const toDynogelTableDefinition: (cloudformation: AWS.DynamoDB.CreateTableInput) => IDynogelTableDefinition;
export declare const toDynogelIndexDefinition: (cloudformation: AWS.DynamoDB.GlobalSecondaryIndex) => IDynogelIndex;
export declare const doesIndexProjectProperty: ({ table, index, property }: {
    table: Table;
    index: IDynogelIndex;
    property: string;
}) => boolean;
export declare const uniqueStrict: (arr: any) => any[];
export declare const hookUp: (fn: any, event: any) => (...args: any[]) => Promise<any>;
export declare const getTemplateStringVariables: (str: string) => string[];
export declare const canRenderTemplate: (template: any, item: any) => boolean;
export declare const renderTemplate: (str: any, data: any) => any;
export declare const normalizeIndexedProperty: (property: string | string[] | IDynamoDBKey | IndexedProperty) => IndexedProperty;
export { promisify, debug, bindAll, runWithBackoffWhile, runWithBackoffOnTableNotExists, waitTillActive, minBy, sha256, wait, defaultBackoffFunction, validateTableName, getFilterType };

import { IDynogelTableDefinition, IDynogelIndex, PropsDeriver } from '../types';
import { DB } from '../';
export declare const defaultTableDefinition: IDynogelTableDefinition;
export declare const defaultIndexes: IDynogelIndex[];
export declare const getCommonTableOpts: (tableName: any, indexes?: any) => {
    maxItemSize: number;
    validate: boolean;
    tableDefinition: IDynogelTableDefinition;
    derivedProperties: string[];
    deriveProperties: PropsDeriver;
    resolveOrderBy?: (hashKey: string, property: string) => string;
};
export declare const createDB: ({ models, objects, docClient, indexes, tableNames }: {
    models: any;
    objects: any;
    docClient: any;
    indexes: any;
    tableNames: any;
}) => DB;

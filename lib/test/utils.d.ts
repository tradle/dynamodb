import { IDynogelTableDefinition, IDynogelIndex, PropsDeriver, ResolveOrderBy } from '../types';
import { DB } from '../';
export declare const defaultTableDefinition: IDynogelTableDefinition;
export declare const defaultIndexes: IDynogelIndex[];
export declare const getCommonTableOpts: (tableName: any, indexes?: any) => {
    maxItemSize: number;
    validate: boolean;
    tableDefinition: IDynogelTableDefinition;
    derivedProps: string[];
    deriveProps: PropsDeriver;
    resolveOrderBy?: ResolveOrderBy;
};
export declare const createDB: ({ models, objects, docClient, indexes, tableNames }: {
    models: any;
    objects: any;
    docClient: any;
    indexes: any;
    tableNames: any;
}) => DB;

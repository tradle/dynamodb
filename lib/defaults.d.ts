import { GetIndexesForModel, GetPrimaryKeysForModel, PropsDeriver, ResolveOrderBy, DerivedPropsParser } from './types';
export declare const primaryKeys: {
    hashKey: string;
    rangeKey: {
        template: string;
    };
};
export declare const indexes: {
    hashKey: string;
    rangeKey: string;
}[];
export declare const getIndexesForModel: GetIndexesForModel;
export declare const getPrimaryKeysForModel: GetPrimaryKeysForModel;
export declare const resolveOrderBy: ResolveOrderBy;
export declare const deriveProps: PropsDeriver;
export declare const parseDerivedProps: DerivedPropsParser;

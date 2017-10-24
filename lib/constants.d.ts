import { DynogelIndex } from './types';
declare const constants: {
    typeAndPermalinkProperty: string;
    minifiedFlag: string;
    separator: string;
    defaultPrimaryKeys: {
        hashKey: string;
    };
    defaultIndexes: DynogelIndex[];
    defaultOrderBy: {
        property: string;
        desc: boolean;
    };
    dateModifiedProperty: string;
    defaultLimit: number;
    batchWriteLimit: number;
};
export = constants;

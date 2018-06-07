import { ILogger } from './types';
export declare const primaryKeys: {
    hashKey: string;
    rangeKey: {
        template: string;
    };
};
export declare const indexes: {
    hashKey: any;
    rangeKey: string;
}[];
export declare const logger: ILogger;

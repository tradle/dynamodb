import { Table } from './table';
export declare const getControlLatestOptions: (table: Table, method: string, resource: any) => {
    ConditionExpression: string;
    ExpressionAttributeNames: {};
    ExpressionAttributeValues: {
        ':link': any;
    };
};
export declare const createControlLatestHook: (table: Table, method: string) => ({ args }: {
    args: any;
}) => Promise<void>;

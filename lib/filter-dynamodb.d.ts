import { IDynogelIndex } from './types';
import { Table } from './table';
export default function (opts: any): Promise<{
    items: any;
    startPosition: any;
    endPosition: any;
    index: IDynogelIndex;
    itemToPosition: Function;
}>;
export declare const expandFilter: (table: Table, filter: any) => any;

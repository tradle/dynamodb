import { DynogelIndex } from './types';
export default function (opts: any): Promise<{
    items: any;
    startPosition: any;
    endPosition: any;
    index: DynogelIndex;
    itemToPosition: Function;
}>;

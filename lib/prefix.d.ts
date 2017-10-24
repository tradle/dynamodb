declare function getUniquePrefix(type: any): string;
declare function prefixKeys(obj: any, prefix: string, skip?: string[]): {};
declare function prefixValues(obj: any, prefix: string, skip: string[]): {};
declare function unprefixKeys(obj: any, prefix: string, skip?: string[]): {};
declare function prefixString(str: any, prefix: any): string;
declare function unprefixString(str: any, prefix: any): any;
export { prefixKeys, unprefixKeys, prefixValues, getUniquePrefix, prefixString, unprefixString };

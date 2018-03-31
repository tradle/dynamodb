declare const constants: {
    minifiedFlag: string;
    separator: string;
    defaultOrderBy: {
        property: string;
        desc: boolean;
    };
    dateModifiedProperty: string;
    defaultLimit: number;
    batchWriteLimit: number;
    PRIMARY_KEYS_PROPS: string[];
    RANGE_KEY_PLACEHOLDER_VALUE: string;
    DEFAULT_RANGE_KEY: string;
};
export = constants;

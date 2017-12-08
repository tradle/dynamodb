declare const constants: {
    typeAndPermalinkProperty: string;
    minifiedFlag: string;
    separator: string;
    defaultPrimaryKeys: {
        hashKey: string;
    };
    defaultIndexes: {
        KeySchema: {
            KeyType: string;
            AttributeName: string;
        }[];
        Projection: {
            ProjectionType: string;
            NonKeyAttributes: any[];
        };
    }[];
    defaultOrderBy: {
        property: string;
        desc: boolean;
    };
    dateModifiedProperty: string;
    defaultLimit: number;
    batchWriteLimit: number;
};
export = constants;

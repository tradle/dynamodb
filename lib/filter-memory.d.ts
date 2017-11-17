declare const comparators: {
    EQ: ({models, property, condition, value}: {
        models: any;
        property: any;
        condition: any;
        value: any;
    }) => any;
    NEQ: (...args: any[]) => boolean;
    IN: ({value, condition}: {
        value: any;
        condition: any;
    }) => any;
    NOT_IN: ({value, condition}: {
        value: any;
        condition: any;
    }) => any;
    STARTS_WITH: ({value, condition}: {
        value: any;
        condition: any;
    }) => any;
    CONTAINS: ({value, condition}: {
        value: any;
        condition: any;
    }) => boolean;
    NOT_CONTAINS: ({value, condition}: {
        value: any;
        condition: any;
    }) => boolean;
    BETWEEN: ({value, condition}: {
        value: any;
        condition: any;
    }) => boolean;
    LT: ({value, condition}: {
        value: any;
        condition: any;
    }) => boolean;
    LTE: ({value, condition}: {
        value: any;
        condition: any;
    }) => boolean;
    GT: ({value, condition}: {
        value: any;
        condition: any;
    }) => boolean;
    GTE: ({value, condition}: {
        value: any;
        condition: any;
    }) => boolean;
    NULL: ({value, condition}: {
        value: any;
        condition: any;
    }) => boolean;
};
export { filterResults, isEqual, comparators };
declare function isEqual({models, property, condition, value}: {
    models: any;
    property: any;
    condition: any;
    value: any;
}): any;
declare function filterResults({models, model, results, filter}: {
    models: any;
    model: any;
    results: any;
    filter: any;
}): any;

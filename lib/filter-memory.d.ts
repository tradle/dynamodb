import { FilterResultsInput, MatchesFilterInput, IsEqualInput } from './types';
export declare const isEqual: ({ models, property, condition, value }: IsEqualInput) => any;
export declare const matchesFilter: ({ models, model, object, filter }: MatchesFilterInput) => boolean;
export declare const filterResults: ({ models, model, results, filter }: FilterResultsInput) => any[];
export declare const comparators: {
    EQ: ({ models, property, condition, value }: IsEqualInput) => any;
    NEQ: (...args: any[]) => boolean;
    IN: ({ value, condition }: {
        value: any;
        condition: any;
    }) => any;
    NOT_IN: ({ value, condition }: {
        value: any;
        condition: any;
    }) => any;
    STARTS_WITH: ({ value, condition }: {
        value: any;
        condition: any;
    }) => any;
    CONTAINS: ({ value, condition }: {
        value: any;
        condition: any;
    }) => boolean;
    NOT_CONTAINS: ({ value, condition }: {
        value: any;
        condition: any;
    }) => boolean;
    BETWEEN: ({ value, condition }: {
        value: any;
        condition: any;
    }) => boolean;
    LT: ({ value, condition }: {
        value: any;
        condition: any;
    }) => boolean;
    LTE: ({ value, condition }: {
        value: any;
        condition: any;
    }) => boolean;
    GT: ({ value, condition }: {
        value: any;
        condition: any;
    }) => boolean;
    GTE: ({ value, condition }: {
        value: any;
        condition: any;
    }) => boolean;
    NULL: ({ value, condition }: {
        value: any;
        condition: any;
    }) => boolean;
};

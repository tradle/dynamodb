
when scanning GSI, no need to fetch additional properties from table, as they are fetched from `objects` store


projection doesn't need to be ALL, it should probably just be the indexed props


orderBy - multiple properties, e.g. orderBy author, and for equal author, orderBy time


batchPut - should be extracted/refactored as dynamodb allows one batchPut to hit multiple tables

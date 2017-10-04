
when scanning GSI, no need to fetch additional properties from table, as they are fetched from `objects` store


projection doesn't need to be ALL, it should probably just be the indexed props


orderBy - multiple properties, e.g. orderBy author, and for equal author, orderBy time


batchPut - should be extracted/refactored as dynamodb allows one batchPut to hit multiple tables

how would this work if tables were not per-type, but rather buckets of types?
  - primary keys would need to be the same for all tables
    - or primary keys could be represented as GSIs
  - db would need a resolve query-to-table function
  - with multiple types in one table, so dynogels schema validation needs to be turned off completely
  - certain types might get dedicated tables
  
  example:
    tradle.SimpleMessage and tradle.PersonalInfo share a table
    primary keys:
      hashKey: _t + _link (default for all)

because of minification:
  - when running a search, for every condition need to check if _cut contains that property

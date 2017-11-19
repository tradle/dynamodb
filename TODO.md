check if orderBy desc/asc works with both before/after (check all 4 combinations, for both scan and query)

orderBy 
  - multiple properties, e.g. orderBy author, and for equal author, orderBy time

because of minification:
  - when running a search, for every condition need to check if _cut contains that property

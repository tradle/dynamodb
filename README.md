
# @tradle/dynamodb

tl;dr: define models for your data with different primary keys and indexes, throw them all in one DynamoDB table, and get efficient querying out of the box.

## Purpose

We created this ORM tool at Tradle to achieve several goals with DynamoDB:

- index an arbitrary number of models according whatever properties make sense for each one individually, all in one table (we use "index overloading")
- be able to easily re-index all resources for a given model if the model changes ("index overloading" to the rescue again)
- be able to create a table first and design data models later. Otherwise you really have to get it right the first time!

## Usage

See an [example](./src/example.ts)

## Trade-offs

Your *table*'s primary keys and indexes are shared across all models. Based on what you choose as primary keys and indexes per *model*, those properties will get stored in duplicate: as properties of the object iself, as well as projected into the table's overloaded primary keys and indexes.

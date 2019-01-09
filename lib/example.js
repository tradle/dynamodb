"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const tslib_1 = require("tslib");
const aws_sdk_1 = tslib_1.__importDefault(require("aws-sdk"));
const _1 = require("./");
aws_sdk_1.default.config.update({
    region: 'us-east-1',
    dynamodb: {
        // localstack
        endpoint: 'http://localhost:4569'
    }
});
const docClient = new aws_sdk_1.default.DynamoDB.DocumentClient();
// your table's definition, as CloudFormation
const tableDefinition = require('./test/fixtures/table-schema');
const TABLE_NAME = tableDefinition.TableName;
// in our example schema, both primary keys and indexes are derived properties
// overloaded indexes are ALWAYS derived props
const derivedProps = tableDefinition.AttributeDefinitions.map(def => def.AttributeName);
// optional
const logger = {
    log: (...args) => console.log(...args),
    error: (...args) => console.log('[ERROR]', ...args),
    warn: (...args) => console.log('[WARN]', ...args),
    info: (...args) => console.log('[INFO]', ...args),
    debug: (...args) => console.log('[DEBUG]', ...args),
    silly: (...args) => console.log('[SILLY]', ...args),
};
const myNameModel = {
    "id": "tradle.Name",
    "title": "Name",
    "type": "tradle.Model",
    "properties": {
        "givenName": {
            "title": "Given name(s)",
            "type": "string",
            "sample": "name.firstName"
        },
        "surname": {
            "type": "string",
            "sample": "name.lastName"
        }
    },
    "primaryKeys": {
        "hashKey": "surname",
        "rangeKey": "givenName"
    },
    "indexes": [
        // index on givenName too
        {
            hashKey: 'givenName',
            rangeKey: 'surname',
        }
    ]
};
const models = {
    [myNameModel.id]: myNameModel
};
const db = _1.createDB({
    modelStore: _1.createModelStore({ models }),
    tableNames: [TABLE_NAME],
    // specify the definition for a particular table
    defineTable: name => {
        // name === TABLE_NAME in our case, cause we only have one table
        const table = _1.createTable({
            docClient,
            tableDefinition,
            derivedProps,
            models,
            // all models in one table in this example
            modelsStored: models,
            // object storage if you have it:
            // objects,
            // define your rules for (dis)allowing potentially expensive table scans
            allowScan: search => true,
            // define your rules for minifying objects
            // if you have additional object storage
            shouldMinify: item => false,
        });
        return table;
    },
    // optional, as we only have one table
    // chooseTable: ({ tables, type }) => db.tablesByName[TABLE_NAME],
    // optional
    logger,
});
const findBySurname = async (surname) => {
    const { items } = await db.find({
        filter: {
            EQ: {
                _t: 'tradle.Name',
                surname,
            }
        }
    });
    return items;
};
const findByGivenName = async (givenName) => {
    const { items } = await db.find({
        filter: {
            EQ: {
                _t: 'tradle.Name',
                givenName,
            }
        }
    });
    return items;
};
const play = async () => {
    // usually you create the tables first
    await db.createTables();
    await db.batchPut([
        {
            _t: 'tradle.Name',
            givenName: 'Ted',
            surname: 'Logan',
        },
        {
            _t: 'tradle.Name',
            givenName: 'Ted',
            surname: 'Roosevelt',
        },
        {
            _t: 'tradle.Name',
            givenName: 'Bob',
            surname: 'Logan',
        },
    ]);
    const teds = await findByGivenName('Ted');
    console.log('teds', teds);
    const logans = await findBySurname('Logan');
    console.log('logans', logans);
};
play().catch(err => {
    console.error(err.stack);
    process.exitCode = 1;
});
//# sourceMappingURL=example.js.map
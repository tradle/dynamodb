"use strict";
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
module.exports = function createResolvers({ db, objects, models, postProcess }) {
    const update = async ({ model, props }) => {
        const result = await db.update(props);
        return utils_1.resultsToJson(result);
    };
    const put = async ({ model, props }) => {
        const result = await db.put(props);
        return utils_1.resultsToJson(result);
    };
    const getByLink = objects && objects.get;
    const get = async ({ model, key }) => {
        let result;
        try {
            result = await db.get(key);
        }
        catch (err) {
            if (err.name && err.name.toLowerCase() === 'notfound') {
                return null;
            }
            throw err;
        }
        return result ? utils_1.resultsToJson(result) : null;
    };
    const list = async ({ model, select, filter, orderBy, limit, checkpoint }) => {
        if (!filter)
            filter = { EQ: {} };
        if (!filter.EQ)
            filter.EQ = {};
        filter.EQ[constants_1.TYPE] = model.id;
        return db.find({
            select,
            filter,
            orderBy,
            limit,
            checkpoint
        });
    };
    const raw = {
        list,
        get,
        getByLink,
        update
    };
    if (!postProcess)
        return raw;
    const wrapped = {};
    for (let op in raw) {
        wrapped[op] = withPostProcess(raw[op], op);
    }
    return wrapped;
    function withPostProcess(fn, op) {
        return async (...args) => {
            const result = await fn(...args);
            return postProcess(result, op, ...args);
        };
    }
};
//# sourceMappingURL=resolvers.js.map
"use strict";
const tslib_1 = require("tslib");
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
module.exports = function createResolvers({ db, objects, models, postProcess }) {
    const update = ({ model, props }) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        const result = yield db.update(props);
        return utils_1.resultsToJson(result);
    });
    const put = ({ model, props }) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        const result = yield db.put(props);
        return utils_1.resultsToJson(result);
    });
    const getByLink = objects && objects.get;
    const get = ({ model, key }) => tslib_1.__awaiter(this, void 0, void 0, function* () {
        let result;
        try {
            result = yield db.get(key);
        }
        catch (err) {
            if (err.name && err.name.toLowerCase() === 'notfound') {
                return null;
            }
            throw err;
        }
        return result ? utils_1.resultsToJson(result) : null;
    });
    const list = ({ model, select, filter, orderBy, limit, checkpoint }) => tslib_1.__awaiter(this, void 0, void 0, function* () {
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
    });
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
        return (...args) => tslib_1.__awaiter(this, void 0, void 0, function* () {
            const result = yield fn(...args);
            return postProcess(result, op, ...args);
        });
    }
};
//# sourceMappingURL=resolvers.js.map
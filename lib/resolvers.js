"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
const constants_1 = require("@tradle/constants");
const utils_1 = require("./utils");
module.exports = function createResolvers({ db, objects, models, postProcess }) {
    const update = ({ model, props }) => __awaiter(this, void 0, void 0, function* () {
        const result = yield db.update(props);
        return utils_1.resultsToJson(result);
    });
    const put = ({ model, props }) => __awaiter(this, void 0, void 0, function* () {
        const result = yield db.put(props);
        return utils_1.resultsToJson(result);
    });
    const getByLink = objects && objects.get;
    const get = ({ model, key }) => __awaiter(this, void 0, void 0, function* () {
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
    const list = ({ model, select, filter, orderBy, limit, checkpoint }) => __awaiter(this, void 0, void 0, function* () {
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
        return (...args) => __awaiter(this, void 0, void 0, function* () {
            const result = yield fn(...args);
            return postProcess(result, op);
        });
    }
};
//# sourceMappingURL=resolvers.js.map
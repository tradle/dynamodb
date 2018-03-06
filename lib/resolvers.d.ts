import { Models, Objects } from './types';
import DB from './db';
declare const _default: ({ db, objects, models, postProcess }: {
    db: DB;
    models: Models;
    objects: Objects;
    postProcess?: Function;
}) => {};
export = _default;

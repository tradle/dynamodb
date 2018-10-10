import {
  createTable,
} from './table'

import {
  ITableOpts,
  ReindexOpts,
  Model,
  Table,
  IndexedProperty,
} from './types'

import * as Errors from './errors'

const getTypeIndexIndex = (indexes: IndexedProperty[]) => indexes.findIndex(i => i.hashKey.template === '{_t}')

const createTableWithModel = ({ tableOpts, model }: {
  tableOpts: ITableOpts
  model: Model
}) => {
  const table = createTable(tableOpts)
  table.storeResourcesForModel({ model })
  return table
}

export const reindex = async ({ newModel, oldModel, batchSize, tableOpts }: ReindexOpts) => {
  const oldTable = createTableWithModel({ tableOpts, model: oldModel })
  const oldIndexes = tableOpts.getIndexesForModel({ table: oldTable, model: oldModel })
  const oldTypeIndex = getTypeIndexIndex(oldIndexes)
  if (!oldTypeIndex) {
    throw new Errors.InvalidInput(`expected old model to be indexed on _t`)
  }

  const newTable = createTableWithModel({ tableOpts, model: newModel })
  let batch
  do {
    batch = oldTable.
  } while (batch.length)
}

// export const reindexHelper = async ({ oldTable, newTable }: {
//   table: Table
//   getNextBatch: () => Promise<any[]>
// }) => {
//   let batch = []
//   do {
//     batch = await getNextBatch()
//   } while (batch.length)
// }

import { IIndex } from './types'

const defaultIndex:IIndex = {
  hashKey: '_author',
  rangeKey: '_time',
  name: '_author',
  type: 'global',
  // expensive
  // can we get away with ProjectionType KEYS_ONLY?
  projection: {
    ProjectionType: 'ALL'
  }
}

const defaultIndexes:IIndex[] = [defaultIndex]

const constants = {
  minifiedFlag: '_cut',
  separator: '_',
  defaultPrimaryKeys: {
    hashKey: '_type',
    rangeKey: '_permalink'
  },
  defaultIndexes,
  defaultOrderBy: {
    property: '_time',
    desc: true
  },
  defaultLimit: 50,
  batchWriteLimit: 25
}

export = constants

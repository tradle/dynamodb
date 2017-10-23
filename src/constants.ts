import { DynogelIndex } from './types'

const defaultIndex:DynogelIndex = {
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

const defaultIndexes:DynogelIndex[] = [defaultIndex]

const constants = {
  minifiedFlag: '_cut',
  separator: '_',
  defaultPrimaryKeys: {
    hashKey: '_tpermalink'
  },
  defaultIndexes,
  defaultOrderBy: {
    property: '_time',
    desc: true
  },
  dateModifiedProperty: '_dateModified',
  defaultLimit: 50,
  batchWriteLimit: 25
}

export = constants

import { DynogelIndex } from './types'
import { TYPE } from '@tradle/constants'

const defaultIndex:DynogelIndex = {
  hashKey: '_author',
  rangeKey: '_time',
  name: '_author',
  type: 'global',
  // expensive
  // can we get away with ProjectionType KEYS_ONLY?
  projection: {
    ProjectionType: 'INCLUDE',
    NonKeyAttributes: [TYPE]
  }
}

const defaultIndexes:DynogelIndex[] = [defaultIndex]

const typeAndPermalinkProperty = '_tpermalink'
const constants = {
  typeAndPermalinkProperty,
  minifiedFlag: '_cut',
  separator: '_',
  defaultPrimaryKeys: {
    hashKey: typeAndPermalinkProperty
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

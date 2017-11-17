import { DynogelIndex } from './types'
import { TYPE } from '@tradle/constants'

const authorIndex:DynogelIndex = {
  hashKey: '_author',
  rangeKey: '_time',
  name: '_author',
  type: 'global',
  // expensive
  // can we get away with ProjectionType KEYS_ONLY?
  projection: {
    ProjectionType: 'INCLUDE',
    NonKeyAttributes: [TYPE, '_link']
  }
}

const typeIndex:DynogelIndex = {
  hashKey: '_t',
  rangeKey: '_time',
  name: 'type',
  type: 'global',
  // expensive
  // can we get away with ProjectionType KEYS_ONLY?
  projection: {
    ProjectionType: 'INCLUDE',
    NonKeyAttributes: ['_author', '_link']
  }
}

const defaultIndexes:DynogelIndex[] = [authorIndex, typeIndex]

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

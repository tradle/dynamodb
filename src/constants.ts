import _ from 'lodash'
import { IDynogelIndex } from './types'
import { TYPE } from '@tradle/constants'

// const keyAndValue = prop => item => `${prop}:${item[prop]}`

const defaultIndexPropertyNames = _.range(5).map(i => `__x__${i}`)
const authorIndex:IDynogelIndex = {
  hashKey: defaultIndexPropertyNames[0],
  rangeKey: '_time',
  // name: '_author',
  name: 'idx0',
  type: 'global',
  // expensive
  // can we get away with ProjectionType KEYS_ONLY?
  projection: {
    ProjectionType: 'INCLUDE',
    NonKeyAttributes: [TYPE, '_link']
  }
}

const typeIndex:IDynogelIndex = {
  hashKey: defaultIndexPropertyNames[1],
  rangeKey: '_time',
  // name: 'type',
  name: 'idx1',
  type: 'global',
  // expensive
  // can we get away with ProjectionType KEYS_ONLY?
  projection: {
    ProjectionType: 'INCLUDE',
    NonKeyAttributes: ['_author', '_link']
  }
}

const defaultIndexes:IDynogelIndex[] = [authorIndex, typeIndex]

const typeAndPermalinkProperty = '_tpermalink'
const defaultHashKeyProperty = '__hashKey__'
const defaultRangeKeyProperty = '__rangeKey__'
const constants = {
  // typeAndPermalinkProperty,
  minifiedFlag: '_cut',
  separator: '::',
  // defaultHashKeyProperty,
  // defaultRangeKeyProperty,
  // defaultPrimaryKeys: {
  //   hashKey: defaultHashKeyProperty
  //   // hashKey: typeAndPermalinkProperty
  // },
  // defaultIndexes,
  defaultOrderBy: {
    property: '_time',
    desc: true
  },
  dateModifiedProperty: '_dateModified',
  defaultLimit: 50,
  batchWriteLimit: 25,
  PRIMARY_KEYS_PROPS: ['hashKey', 'rangeKey'],
  // defaultIndexPropertyNames
}

export = constants

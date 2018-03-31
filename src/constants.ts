
const constants = {
  minifiedFlag: '_cut',
  separator: '::',
  defaultOrderBy: {
    property: '_time',
    desc: true
  },
  dateModifiedProperty: '_dateModified',
  defaultLimit: 50,
  batchWriteLimit: 25,
  PRIMARY_KEYS_PROPS: ['hashKey', 'rangeKey'],
  RANGE_KEY_PLACEHOLDER_VALUE: '_',
  DEFAULT_RANGE_KEY: '_time'
  // defaultIndexPropertyNames
}

export = constants

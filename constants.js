
module.exports = {
  minifiedFlag: '_cut',
  separate: '_',
  defaultPrimaryKeys: {
    hashKey: '_type',
    rangeKey: '_permalink'
  },
  defaultIndexes: [
    // expensive
    // can we get away with ProjectionType KEYS_ONLY?
    {
      hashKey: '_author',
      rangeKey: '_time',
      name: 'AuthorAndDateIndex',
      type: 'global',
      projection: {
        ProjectionType: 'ALL'
      }
    }
  ],
  defaultOrderBy: {
    property: '_time',
    desc: true
  },
  defaultLimit: 50
}

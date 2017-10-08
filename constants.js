
module.exports = {
  minifiedFlag: '_cut',
  defaultPrimaryKeys: {
    hashKey: '_link'
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
    },
    {
      hashKey: '_permalink',
      rangeKey: '_time',
      name: 'PermalinkAndDateIndex',
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

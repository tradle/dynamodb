
module.exports = {
  hashKey: '_link',
  minifiedFlag: '_cut',
  defaultOrderBy: {
    property: '_time',
    desc: true
  },
  defaultIndexes: [
    {
      hashKey: '_author',
      rangeKey: '_time',
      name: 'AuthorAndDateIndex',
      type: 'global'
    },
    {
      hashKey: '_permalink',
      rangeKey: '_time',
      name: 'PermalinkAndDateIndex',
      type: 'global'
    }
  ]
}

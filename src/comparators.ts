const {
  pick,
  traverse
} = require('./utils')

const CREATE_EQUALITY_CHECK = method => {
  const checkStrict = ({ where, key, value }) => {
    return where(key)[method](value)
  }

  return function addEqualityCheck ({ where, key, value }) {
    if (method === 'ne' || (value == null || typeof value !== 'object')) {
      return checkStrict({ where, key, value })
    }

    // this may backfire in the following way:
    //
    // filter = {
    //   name: {
    //     first: 'Abby',
    //     last: 'Shmabby'
    //   }
    // }
    //
    // result:
    //
    // {
    //   first: 'Abby',
    //   last: 'Shmabby',
    //   middle: 'Falama fama fo flabby'
    // }
    //
    // maybe this result is desired, maybe not
    //
    // should probably add STRICT_EQ as an operator
    forEachLeaf(value, ({ path, value }) => {
      path = path.slice()
      path.unshift(key)
      where(path.join('.'))[method](value)
    })
  }
}

const CHECK_NULL = ({ where, key, value }) => {
  if (value) {
    where(key).null()
  } else {
    where(key).notNull()
  }
}

const ALL_COMPARATORS = {
  EQ: CREATE_EQUALITY_CHECK('eq'),
  NEQ: CREATE_EQUALITY_CHECK('ne'),
  NULL: CHECK_NULL,
  CONTAINS: ({ where, key, value }) => where(key).contains(value),
  NOT_CONTAINS: ({ where, key, value }) => where(key).notContains(value),
  STARTS_WITH: ({ where, key, value }) => where(key).beginsWith(value),
  LT: ({ where, key, value }) => where(key).lt(value),
  LTE: ({ where, key, value }) => where(key).lte(value),
  GT: ({ where, key, value }) => where(key).gt(value),
  GTE: ({ where, key, value }) => where(key).gte(value),
  BETWEEN: ({ where, key, value }) => where(key).between(...value),
  IN: ({ where, key, value }) => where(key).in(value),
  NOT_IN: ({ where, key, value }) => {
    value.forEach(subVal => where(key).ne(subVal))
  }
}

const QUERY_COMPARATORS = pick(ALL_COMPARATORS, [
  'EQ',
  'LT',
  'LTE',
  'GT',
  'GTE',
  'STARTS_WITH',
  'BETWEEN'
])

const getComparators = ({
  queryInfo,
  property
}) => {
  if (queryInfo.opType === 'query') {
    const { hashKey, rangeKey } = queryInfo.index || queryInfo
    if (property === rangeKey) {
      return QUERY_COMPARATORS
    }
  }

  return ALL_COMPARATORS
}

function forEachLeaf (obj, fn) {
  traverse(obj).forEach(function (value) {
    if (this.isLeaf) {
      fn({ value, path: this.path })
    }
  })
}

export {
  getComparators
}

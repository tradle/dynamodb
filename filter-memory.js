const OPERATORS = require('./operators')
const {
  debug,
  omit,
  deepEqual,
  fromResourceStub,
  BaseObjectModel
} = require('./utils')

const comparators = {
  EQ: isEqual,
  NEQ: negate(isEqual),
  IN: ({ value, condition }) => condition.some(one => deepEqual(one, value)),
  STARTS_WITH: ({ value, condition }) => value && value.startsWith(condition),
  CONTAINS: ({ value, condition }) => value && value.indexOf(condition) !== -1,
  NOT_CONTAINS: ({ value, condition }) => !value || value.indexOf(condition) === -1,
  BETWEEN: ({ value, condition }) => value >= condition[0] && value < condition[1],
  LT: ({ value, condition }) => value < condition,
  LTE: ({ value, condition }) => value <= condition,
  GT: ({ value, condition }) => value > condition,
  GTE: ({ value, condition }) => value >= condition,
  EXISTS: ({ value, condition }) => condition ? !!value : !value,
}

module.exports = {
  filterResults,
  // matchesProps,
  isEqual,
  comparators
}

// function matchesProps ({ model, object, values }) {
//   return Object.keys(values).every(propertyName => {
//     const property = model.properties[propertyName]
//     return isEqual({
//       model,
//       propertyName,
//       property,
//       expected: object[propertyName],
//       value: values[propertyName]
//     })
//   })
// }

function isEqual ({ model, property, condition, value }) {
  const { type } = property
  if (type !== 'array' && type !== 'object') {
    return deepEqual(condition, value)
  }

  if (type === 'array') {
    debug(`not comparing array valued search property`)
    return false
  }

  const metadata = fromResourceStub(condition)
  return metadata.link === value
}

function matchesFilter ({ model, object, filter }) {
  if (!filter) return true

  for (let op in filter) {
    if (!(op in comparators)) {
      throw new Error(`operator "${op}" not supported (yet)`)
    }

    let conditions = filter[op]
    for (let propertyName in conditions) {
      if (propertyName in OPERATORS) {
        debug('nested operators not support (yet)')
        continue
      }

      let property = model.properties[propertyName]
      let matches = isEqual({
        model,
        propertyName,
        property,
        condition: conditions[propertyName],
        value: object[propertyName]
      })
    }
  }

  return true
}

function filterResults ({ model, results, filter }) {
  if (!filter || !Object.keys(filter).length) {
    return results
  }

  return results.filter(object => {
    return matchesFilter({ model, object, filter })
  })
}

function isHeaderProperty (propertyName) {
  return propertyName in BaseObjectModel.properties
}

function negate (fn) {
  return function (...args) {
    return !fn.apply(this, args)
  }
}

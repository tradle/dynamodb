import dotProp = require('dot-prop')
import validateResource = require('@tradle/validate-resource')
import { TYPE } from '@tradle/constants'
import OPERATORS = require('./operators')
const { getRef } = validateResource.utils
import {
  debug,
  omit,
  deepEqual,
  fromResourceStub
} from './utils'

import BaseObjectModel from './object-model'

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
  NULL: ({ value, condition }) => condition ? !value : !!value,
}

export {
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

function isEqual ({ models, property, condition, value }) {
  const type = property && property.type
  if (type !== 'array' && type !== 'object') {
    return deepEqual(condition, value)
  }

  const ref = getRef(property)
  if (property.inlined || (ref && models[ref].inlined)) {
    return deepEqual(condition, value)
  }

  if (type === 'array') {
    debug(`not comparing array valued search property`)
    return false
  }

  const metadata = fromResourceStub(condition)
  return metadata.link === value
}

function matchesFilter ({ models, object, filter }) {
  if (!filter) return true

  const model = models[object[TYPE]]
  for (let op in filter) {
    if (!(op in comparators)) {
      throw new Error(`operator "${op}" not supported (yet)`)
    }

    let compare = comparators[op]
    let conditions = filter[op]
    for (let propertyName in conditions) {
      if (propertyName in OPERATORS) {
        debug('nested operators not support (yet)')
        continue
      }

      let property = model.properties[propertyName]
      let isMatch = compare({
        models,
        model,
        propertyName,
        property,
        condition: conditions[propertyName],
        value: dotProp.get(object, propertyName)
      })

      if (!isMatch) return false
    }
  }

  return true
}

function filterResults ({ models, results, filter }) {
  if (!filter || !Object.keys(filter).length) {
    return results
  }

  return results.filter(object => {
    return matchesFilter({ models, object, filter })
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
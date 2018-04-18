import _ = require('lodash')
import validateResource = require('@tradle/validate-resource')
import { TYPE } from '@tradle/constants'
import Errors from '@tradle/errors'
import OPERATORS = require('./operators')
const { getRef, isDescendantOf } = validateResource.utils
import {
  debug,
  fromResourceStub
} from './utils'

import BaseObjectModel from './object-model'
import {
  FilterResultsInput,
  MatchesFilterInput,
  IsEqualInput
} from './types'

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

const isHeaderProperty = (propertyName) => {
  return propertyName in BaseObjectModel.properties
}

const negate = (fn) => {
  return function (...args) {
    return !fn.apply(this, args)
  }
}

export const isEqual = ({ models, property, condition, value }: IsEqualInput) => {
  if (shouldCompareWithDeepEqual({ models, property })) {
    return _.isEqual(condition, value)
  }

  const type = property && property.type
  if (type === 'array') {
    debug(`not comparing array valued search property`)
    return false
  }

  debugger
  return condition._link === value
}

const shouldCompareWithDeepEqual = ({ models, property }) => {
  const type = property && property.type
  // primitive
  if (type !== 'array' && type !== 'object') return true

  // schema-less
  if (property.range === 'json') return true

  const ref = getRef(property)
  return property.inlined || (ref && models[ref].inlined)
}

export const matchesFilter = ({ models, model, object, filter }: MatchesFilterInput) => {
  if (!filter) return true

  if (!model) model = models[object[TYPE]]

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
        value: _.get(object, propertyName)
      })

      if (!isMatch) return false
    }
  }

  return true
}

export const filterResults = ({ models, model, results, filter }: FilterResultsInput) => {
  if (!filter || !Object.keys(filter).length) {
    return results
  }

  return results.filter(object => {
    return matchesFilter({ models, model, object, filter })
  })
}

export const comparators = {
  EQ: isEqual,
  NEQ: negate(isEqual),
  IN: ({ value, condition }) => condition.some(one => _.isEqual(one, value)),
  NOT_IN: ({ value, condition }) => condition.every(one => !_.isEqual(one, value)),
  STARTS_WITH: ({ value, condition }) => value && value.startsWith(condition),
  CONTAINS: ({ value, condition }) => value && value.indexOf(condition) !== -1,
  NOT_CONTAINS: ({ value, condition }) => !value || value.indexOf(condition) === -1,
  BETWEEN: ({ value, condition }) => value >= condition[0] && value < condition[1],
  LT: ({ value, condition }) => value < condition,
  LTE: ({ value, condition }) => value <= condition,
  GT: ({ value, condition }) => value > condition,
  GTE: ({ value, condition }) => value >= condition,
  NULL: ({ value, condition }) => condition ? !value : !!value,
  SUBCLASS_OF: ({ models, value, condition }) => {
    try {
      return condition.some(b => isDescendantOf({
        models,
        a: value,
        b
      }))
    } catch (err) {
      Errors.rethrow(err, 'developer')
      return false
    }
  }
}

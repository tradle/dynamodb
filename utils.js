const debug = require('debug')(require('./package.json').name)
const clone = require('clone')
const shallowClone = require('xtend')
const extend = require('xtend/mutable')
const deepEqual = require('deep-equal')
const pick = require('object.pick')
const omit = require('object.omit')
const co = require('co').wrap
const promisify = require('pify')
const BaseObjectModel = require('@tradle/models')['tradle.Object']
const { hashKey, defaultIndexes } = require('./constants')
const OPERATORS = require('./operators')
const TYPE = '_t'

module.exports = {
  BaseObjectModel,
  fromResourceStub,
  sortResults,
  co,
  promisify,
  debug,
  clone,
  shallowClone,
  extend,
  deepEqual,
  pick,
  omit,
  toObject,
  getIndexes,
  getTableName,
  resultsToJson,
  getQueryInfo
}

function getTableName ({ model, prefix='', suffix='' }) {
  const name = (model.id || model).replace(/[.]/g, '_')
  return prefix + name + suffix
}

function getIndexes (model) {
  return defaultIndexes.slice()
}

function sortResults ({ results, orderBy }) {
  const { property, desc } = orderBy
  const asc = !desc // easier to think about
  return results.sort(function (a, b) {
    const aVal = a[property]
    const bVal = b[property]
    if (aVal === bVal) {
      return 0
    }

    if (aVal < bVal) {
      return asc ? -1 : 1
    }

    return asc ? 1 : -1
  })
}

function toObject (arr) {
  const obj = {}
  for (let val of arr) {
    obj[val] = true
  }

  return obj
}

function fromResourceStub (props) {
  const [type, permalink, link] = props.id.split('_')
  return {
    [TYPE]: type,
    link,
    permalink
  }
}

function resultsToJson (items) {
  // return items
  if (Array.isArray(items)) {
    return items.map(item => {
      return item.toJSON ? item.toJSON() : item
    })
  }

  return items.toJSON ? items.toJSON() : items
}

function getUsedProperties ({ model, filter }) {
  const flat = flatten(filter)
  return flat.reduce((all, obj) => {
    return all.concat(Object.keys(obj))
  }, [])
}

/**
 * flattens nested filter
 *
 * has no semantic meaning, this is just to be able to check
 * which props are being filtered against
 */
function flatten (filter) {
  const flat = []
  const batch = [filter]
  let len = batch.length
  while (batch.length) {
    let copy = batch.slice()
    batch.length = 0
    copy.forEach(subFilter => {
      for (let op in subFilter) {
        if (op in OPERATORS) {
          batch.push(subFilter[op])
        } else {
          flat.push(subFilter)
        }
      }
    })
  }

  return flat
}

// function getLeaves (obj) {
//   return traverse(obj).reduce(function (acc, value) {
//     if (this.isLeaf) {
//       return acc.concat({
//         path: this.path,
//         value
//       })
//     }

//     return acc
//   }, [])
// }

function getQueryInfo ({ model, filter }) {
  const indexes = getIndexes({ model })
  const usedProps = getUsedProperties({ model, filter })
  const indexedProps = indexes.map(index => index.hashKey)
    .concat(hashKey)

  const indexedPropsMap = toObject(indexedProps)
  const { EQ } = filter
  const usedIndexedProps = usedProps.filter(prop => {
    return EQ && prop in EQ && prop in indexedPropsMap
  })

  const opType = usedIndexedProps.length
    ? 'query'
    : 'scan'

  let builder
  let queryProp
  let fullScanRequired = true
  let index
  if (opType === 'query') {
    // supported key condition operators:
    // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions

    if (usedIndexedProps.includes(hashKey)) {
      queryProp = hashKey
    } else {
      queryProp = usedIndexedProps[0]
      index = indexes.find(i => i.hashKey === queryProp)
    }
  }

  const itemToPosition = function itemToPosition (item) {
    if (queryProp === hashKey || opType === 'scan') {
      return pick(item, [hashKey])
    }

    const props = [hashKey, index.hashKey, index.rangeKey]
      .filter(prop => prop)

    return pick(item, props)
  }

  return {
    opType,
    queryProp,
    index,
    itemToPosition
  }
}

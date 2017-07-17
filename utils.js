const debug = require('debug')(require('./package.json').name)
const clone = require('clone')
const shallowClone = require('xtend')
const extend = require('xtend/mutable')
const deepEqual = require('deep-equal')
const pick = require('object.pick')
const omit = require('object.omit')
const BaseObjectModel = require('@tradle/models')['tradle.Object']
const { defaultIndexes } = require('./constants')
const TYPE = '_t'

module.exports = {
  BaseObjectModel,
  fromResourceStub,
  sortResults,
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

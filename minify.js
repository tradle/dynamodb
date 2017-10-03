const { TYPE } = require('@tradle/constants')
const { pick, shallowClone, debug, getIndexes } = require('./utils')
const { minifiedFlag } = require('./constants')

module.exports = minify

const MINIFY_PREFERENCES = [
  stripEmbeddedMedia,
  stripBigValues,
  stripOptional,
  stripAll
]

function minify ({ item, model, maxSize }) {
  if (!maxSize || maxSize === Infinity) {
    return { min: item, diff: {} }
  }

  const indexes = getIndexes(model)
  let min = shallowClone(item)
  let diff = {}

  for (const filter of MINIFY_PREFERENCES) {
    // approximation
    const size = byteLength(min)
    if (size < maxSize) break

    let slimmed
    let currentCut = (min[minifiedFlag] || []).slice()
    for (let propertyName in min) {
      if (propertyName.startsWith('_')) {
        continue
      }

      let isIndexed = indexes.some(index => {
        return index.hashKey === propertyName || index.rangeKey === propertyName
      })

      if (isIndexed) continue

      let property = model.properties[propertyName]
      if (!property) {
        debug(`property "${propertyName}" not found in model "${model.id}"`)
        continue
      }

      let keep = filter({
        model,
        propertyName,
        property,
        value: item[propertyName]
      })

      if (keep) continue

      diff[propertyName] = item[propertyName]
      delete min[propertyName]
      if (!min[minifiedFlag]) {
        min[minifiedFlag] = []
      }

      min[minifiedFlag].push(propertyName)
    }
  }

  if (min[minifiedFlag] && min[minifiedFlag].length) {
    const cut = min[minifiedFlag]
    debug(`minified ${item[TYPE]} per max item size (${maxSize}). Removed: ${cut.join(', ')}`)
  }

  return { min, diff }
}

function getRef (property) {
  if (property.ref) return property.ref

  return property.items && property.items.ref
}

function stripEmbeddedMedia ({ value, property }) {
  if (getRef(property) === 'tradle.Photo') {
    if (value && value.url && /data:/.test(value.url)) {
      return false
    }
  }

  return true // don't strip
}

function stripBigValues ({ value }) {
  return byteLength(value) < 100
}

function stripOptional ({ model, propertyName }) {
  return isRequired({ model, propertyName })
}

function stripAll () {
  return false
}

function isRequired ({ model, propertyName }) {
  return model.required && model.required.includes(propertyName)
}

function byteLength (val) {
  const str = typeof val === 'string' ? val : JSON.stringify(val)
  return Buffer.byteLength(str, 'utf8')
}

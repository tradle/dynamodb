const { pick, shallowClone, debug, getIndexes } = require('./utils')

module.exports = minify

const MINIFY_PREFERENCES = [
  stripPhotos,
  stripBigValues,
  stripOptional,
  stripAll
]

function minify ({ item, model, maxSize }) {
  if (!maxSize || maxSize < Infinity) {
    return { min: item, diff: {} }
  }

  const indexes = getIndexes(model)
  let min = shallowClone(item)
  let diff = {}

  for (const filter of MINIFY_PREFERENCES) {
    // approximation
    const size = Buffer.byteLength(JSON.stringify(min), 'utf8')
    if (size < maxSize) break

    let slimmed
    let currentCut = (min._cut || []).slice()
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
      if (!min._cut) {
        min._cut = []
      }

      min._cut.push(propertyName)
    }

    if (!min._cut || currentCut.length === min._cut.length) {
      // give up
      break
    }
  }

  return { min, diff }
}

function getRef (property) {
  if (property.ref) return property.ref

  return property.items && property.items.ref
}

function stripPhotos ({ property }) {
  return getRef(property) !== 'tradle.Photo'
}

function stripBigValues ({ value }) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  return str.length < 50
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

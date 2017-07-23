const { pick, shallowClone, debug } = require('./utils')
const DEFAULT_MAX_SIZE = 1000

module.exports = minify

const MINIFY_PREFERENCES = [
  stripPhotos,
  stripBigValues,
  stripOptional,
  stripAll
]

function minify ({ item, model, maxSize=DEFAULT_MAX_SIZE }) {
  let min = shallowClone(item)
  let diff = {}

  for (const filter of MINIFY_PREFERENCES) {
    const size = JSON.stringify(min).length
    if (size < maxSize) break

    let slimmed
    for (let propertyName in min) {
      if (propertyName.startsWith('_')) {
        continue
      }

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

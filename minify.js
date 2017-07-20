const pick = require('object.pick')
const shallowClone = require('xtend')

module.exports = minify

const MINIFY_PREFERENCES = [
  stripPhotos,
  stripBigValues,
  stripOptional,
  stripAll
]

function minify ({ item, model }) {
  let min = shallowClone(item)
  let diff = {}

  for (const filter of MINIFY_PREFERENCES) {
    const size = JSON.stringify(min).length
    if (size < 1000) break

    let slimmed
    for (let propertyName in min) {
      if (propertyName.startsWith('_')) {
        continue
      }

      let keep = filter({
        model,
        propertyName,
        property: model.properties[propertyName],
        value: item[propertyName]
      })

      if (keep) continue

      diff[propertyName] = item[propertyName]
      delete min[propertyName]
      if (!min._stripped) {
        min._stripped = []
      }

      min._stripped.push(propertyName)
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

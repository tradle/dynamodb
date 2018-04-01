import _ = require('lodash')
import { TYPE } from '@tradle/constants'

import {
  canRenderTemplate,
  renderTemplate,
  normalizeIndexedProperty
} from './utils'

import {
  GetIndexesForModel,
  GetPrimaryKeysForModel,
  PropsDeriver,
  ResolveOrderBy,
  ITableOpts
} from './types'

import {
  RANGE_KEY_PLACEHOLDER_VALUE
} from './constants'

export const primaryKeys = {
  // default for all tradle.Object resources
  hashKey: {
    template: 'tradle.Object_{{_permalink}}'
  },
  rangeKey: {
    template: '_' // constant
  }
}

export const indexes = [
  {
    // default for all tradle.Object resources
    hashKey: {
      template: 'tradle.Object_{{_author}}',
    },
    rangeKey: {
      template: '{{_time}}'
    }
  },
  {
    // default for all tradle.Object resources
    hashKey: {
      template: 'tradle.Object_{{_t}}',
    },
    rangeKey: {
      template: '{{_time}}'
    }
  }
]

export const getIndexesForModel:GetIndexesForModel = ({ table, model }) => {
  return (model.indexes || indexes).map(normalizeIndexedProperty)
}

export const getPrimaryKeysForModel: GetPrimaryKeysForModel = ({ table, model }) => {
  return normalizeIndexedProperty(model.primaryKeys || primaryKeys)
}

export const resolveOrderBy: ResolveOrderBy = ({
  table,
  type,
  hashKey,
  property
}) => {
  const index = table.indexed.find(index => index.hashKey === hashKey)
  const model = table.models[type]
  if (!model) return

  const indexes = table.getKeyTemplatesForModel(model)
  const indexedProp = indexes[table.indexed.indexOf(index)]
  if (!(indexedProp && indexedProp.rangeKey)) return

  const rangeKeyDerivesFromProp = canRenderTemplate(indexedProp.rangeKey.template, { [property]: 'placeholder' })
  if (rangeKeyDerivesFromProp) {
    return index.rangeKey
  }
}

export const deriveProperties: PropsDeriver = ({
  table,
  item,
  isRead
}) => {
  const type = item[TYPE]
  const model = table.models[type]
  const indexes = table.getKeyTemplatesForModel(model)
  const renderable = _.chain(indexes)
    .map((templates, i) => {
      const { hashKey, rangeKey } = table.indexed[i]
      const ret = [{
        property: hashKey,
        template: templates.hashKey.template
      }]

      if (rangeKey) {
        ret.push({
          property: rangeKey,
          template: templates.rangeKey ? templates.rangeKey.template : RANGE_KEY_PLACEHOLDER_VALUE
        })
      }

      return ret
    })
    .flatten()
    // only render the keys for which we have all the variables
    .filter(({ template }) => canRenderTemplate(template, item))
    .value()

  return renderable.reduce((inputs, { property, template }) => {
    inputs[property] = renderTemplate(template, item)
    return inputs
  }, {})
}

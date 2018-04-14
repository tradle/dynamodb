import _ from 'lodash'
import { TYPE } from '@tradle/constants'

import {
  canRenderTemplate,
  renderTemplate,
  normalizeIndexedPropertyTemplateSchema,
  cleanName,
  getTemplateStringVariables,
  getExpandedProperties
} from './utils'

import {
  GetIndexesForModel,
  GetPrimaryKeysForModel,
  PropsDeriver,
  ResolveOrderBy,
  ITableOpts,
  Table,
  Model,
  DerivedPropsParser
} from './types'

import {
  RANGE_KEY_PLACEHOLDER_VALUE,
  separator
} from './constants'

export const primaryKeys = {
  // default for all tradle.Object resources
  hashKey: '_permalink',
  rangeKey: {
    template: '_' // constant
  }
}

export const indexes = [
  {
    // default for all tradle.Object resources
    hashKey: '_author',
    rangeKey: '_time'
  },
  {
    // default for all tradle.Object resources
    hashKey: '_t',
    rangeKey: '_time'
  }
]

export const getIndexesForModel:GetIndexesForModel = ({ table, model }: {
  table: Table
  model: Model
}) => {
  return (model.indexes || indexes).map(index => normalizeIndexedPropertyTemplateSchema(index))
}

export const getPrimaryKeysForModel: GetPrimaryKeysForModel = ({ table, model }: {
  table: Table
  model: Model
}) => {
  return normalizeIndexedPropertyTemplateSchema(model.primaryKeys || primaryKeys)
}

export const resolveOrderBy: ResolveOrderBy = ({
  table,
  type,
  hashKey,
  property
}: {
  table: Table
  type: string
  hashKey: string
  property: string
}) => {
  const model = table.models[type]
  if (!model) return

  const index = table.indexed.find(index => index.hashKey === hashKey)
  const indexes = table.getKeyTemplatesForModel(model)
  const indexedProp = indexes[table.indexed.indexOf(index)]
  if (!(indexedProp && indexedProp.rangeKey)) return

  const rangeKeyDerivesFromProp = canRenderTemplate(indexedProp.rangeKey.template, { [property]: 'placeholder' })
  if (rangeKeyDerivesFromProp) {
    return index.rangeKey
  }
}

export const deriveProps: PropsDeriver = ({
  table,
  item,
  isRead
}) => {
  // expand '.' props
  item = expandNestedProps(item)

  let rType = item[TYPE]
  if (!rType) {
    const { hashKey } = table.indexed.find(i => i.hashKey in item)
    if (!hashKey) {
      throw new Error('unable to deduce resource type')
    }

    rType = item[hashKey].split(separator)[0] // see template below
  }

  const model = table.models[rType]
  const indexes = table.getKeyTemplatesForModel(model)
  const renderable = _.chain(indexes)
    .map((templates, i) => {
      const { hashKey, rangeKey } = table.indexed[i]
      const ret = [{
        property: hashKey,
        template: [
          rType,
          templates.hashKey.template
        ].join(separator)
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

  return renderable.reduce((inputs, { property, template, sort }) => {
    inputs[property] = renderTemplate(template, item)
    return inputs
  }, {})
}

export const parseDerivedProps:DerivedPropsParser = ({ table, model, resource }) => {
  const { models } = table
  const templates = _.chain(table.getKeyTemplatesForModel(model))
    .flatMap(({ hashKey, rangeKey }) => {
      return [
        {
          ...hashKey,
          type: 'hash'
        },
        rangeKey && {
          ...rangeKey,
          type: 'range'
        }
      ]
    })
    .filter(_.identity)
    .filter(info => /^[{]{2}[^}]+[}]{2}$/.test(info.template))
    .value()

  const derived = _.pick(resource, table.derivedProps)
  const yay = {}
  const properties = getExpandedProperties({ models, model })
  return _.transform(derived, (parsed, value, prop) => {
    const info = templates.find(({ key }) => key === prop)
    if (!info) return

    const { key, template, type } = info
    let propVal = value
    if (type === 'hash') {
      propVal = propVal.slice(model.id.length + 2)
    }

    const propName = getTemplateStringVariables(template)[0]
    const propMeta = properties[propName]
    if (!propMeta) return

    const pType = propMeta.type
    // complex props not supported at the moment
    if (pType === 'array' || pType === 'object') return

    if (pType === 'number' || pType === 'date') {
      propVal = parseInt(propVal, 10)
    } else if (pType === 'boolean') {
      propVal = propVal === 'true' || propVal === '1'
    }

    parsed[propName] = propVal
  }, {})
}

const expandNestedProps = obj => {
  const expanded = {}
  for (let key in obj) {
    _.set(expanded, key, obj[key])
  }

  return expanded
}

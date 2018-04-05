import { TYPE } from '@tradle/constants'
import {
  Table
} from './table'

export const getControlLatestOptions = (table: Table, method: string, resource: any) => {
  if (!resource._link) {
    throw new Error('expected "_link"')
  }

  if (method === 'create' && !resource._time) {
    throw new Error('expected "_time"')
  }

  const options = {
    ConditionExpression: Object.keys(table.primaryKeys)
      .map(keyType => `attribute_not_exists(#${keyType})`)
      .join(' and '),
    ExpressionAttributeNames: Object.keys(table.primaryKeys)
      .reduce((names, keyType) => {
        names[`#${keyType}`] = table.primaryKeys[keyType]
        return names
      }, {}),
    ExpressionAttributeValues: {
      ':link': resource._link
    }
  }

  options.ConditionExpression = `(${options.ConditionExpression}) OR #link = :link`
  options.ExpressionAttributeNames['#link'] = '_link'
  if (resource._time) {
    options.ConditionExpression += ' OR #time < :time'
    options.ExpressionAttributeNames['#time'] = '_time'
    options.ExpressionAttributeValues[':time'] = resource._time
  }

  return options
}

export const createControlLatestHook = (table: Table, method: string) => {
  const latestIsSupported = !!table.deriveProps({
    [TYPE]: 'a',
    _permalink: 'b'
  })[table.hashKey]

  return async ({ args }) => {
    if (!latestIsSupported) return

    let [resource, options] = args
    if (!options) {
      args[1] = getControlLatestOptions(table, method, resource)
    }
  }
}

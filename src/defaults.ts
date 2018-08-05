import { TYPE } from '@tradle/constants'
import { ILogger } from './types'

const debug = require('debug')(require('../package.json').name)

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
    hashKey: TYPE,
    rangeKey: '_time'
  },
  {
    // default for all tradle.Object resources
    hashKey: '_author',
    rangeKey: '_time'
  },
]

export const logger: ILogger = {
  log: debug,
  error: debug.bind(null, '[ERROR]'),
  warn: debug.bind(null, '[WARN]'),
  info: debug.bind(null, '[INFO]'),
  debug: debug.bind(null, '[DEBUG]'),
  silly: debug.bind(null, '[SILLY]'),
}

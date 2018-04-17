import { TYPE } from '@tradle/constants'

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
    hashKey: TYPE,
    rangeKey: '_time'
  }
]

import _ = require('lodash')
import { models } from '@tradle/models'
// import { typeAndPermalinkProperty } from './constants'

const BaseObjectModel = models['tradle.Object']
const copy = _.cloneDeep(BaseObjectModel)
// copy.properties[typeAndPermalinkProperty] = {
//   type: 'string',
//   virtual: true
// }

copy.properties._dateModified = {
  type: 'number',
  virtual: true
}

export default copy

import cloneDeep from 'lodash/cloneDeep'
import { models } from '@tradle/models'
// import { typeAndPermalinkProperty } from './constants'

const BaseObjectModel = models['tradle.Object']
const copy = cloneDeep(BaseObjectModel)
// copy.properties[typeAndPermalinkProperty] = {
//   type: 'string',
//   virtual: true
// }

copy.properties._dateModified = {
  type: 'number',
  virtual: true
}

export default copy

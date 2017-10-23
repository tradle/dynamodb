import clone = require('clone')
const BaseObjectModel = require('@tradle/models')['tradle.Object']
const copy = clone(BaseObjectModel)
copy.properties._tpermalink = {
  type: 'string',
  virtual: true
}

copy.required.push('_tpermalink')
export default copy

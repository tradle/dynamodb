const ex = require('error-ex')
const errors = {}
;[
  'NotFound'
].forEach(name => errors[name] = ex(name))

module.exports = errors

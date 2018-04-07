export = {
  EQ: {
    type: 'any'
  },
  NEQ: {
    type: 'any'
  },
  NULL: {
    type: 'any'
  },
  IN: {
    type: 'array'
  },
  NOT_IN: {
    type: 'array'
  },
  BETWEEN: {
    type: 'array',
    scalar: true
  },
  STARTS_WITH: {
    type: 'string',
    scalar: true
  },
  CONTAINS: {
    type: 'string',
    scalar: true
  },
  NOT_CONTAINS: {
    type: 'string',
    scalar: true
  },
  LT: {
    scalar: true
  },
  LTE: {
    scalar: true
  },
  GT: {
    scalar: true
  },
  GTE: {
    scalar: true
  },
  SUBCLASS_OF: {
    type: 'array',
    scalar: true
  },
  // NOT IMPLEMENTED
  // OR: {
  //   type: 'array'
  // },
  // AND: {
  //   type: 'array'
  // }
}

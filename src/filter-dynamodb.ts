import { TYPE } from '@tradle/constants'
import {
  clone,
  pick,
  toObject,
  debug,
  resultsToJson,
  sortResults,
  getQueryInfo,
  promisify,
  deepEqual,
  getModelPrimaryKeys,
  doesIndexProjectProperty
} from './utils'

import OPERATORS = require('./operators')
import { getComparators } from './comparators'
import { filterResults } from './filter-memory'
import { defaultOrderBy, defaultLimit } from './constants'
import { OrderBy, Model, Models, DynogelIndex } from './types'
import Table from './table'

class FilterOp {
  public models:Models
  public model:Model
  public filter:any
  public prefixedFilter:any
  public orderBy:OrderBy
  public prefixedOrderBy:OrderBy
  public limit:number
  public after?: any
  public sortedByDB:boolean
  public queryProp:string
  public opType:string
  public itemToPosition:Function
  public index?:DynogelIndex
  public forbidScan:boolean
  public bodyInObjects:boolean
  public consistentRead:boolean
  public primaryKeys:any
  public builder:any
  public table:Table
  constructor (opts) {
    Object.assign(this, opts)
    this.filter = clone(this.filter)
    const {
      table,
      models,
      orderBy=defaultOrderBy,
      limit=defaultLimit,
      after,
      consistentRead,
      forbidScan,
      bodyInObjects
    } = this

    this.limit = limit
    this.orderBy = orderBy

    Object.assign(this, getQueryInfo(this))
    this.prefixedFilter = {}

    const type = this.filter.EQ[TYPE]
    if (table.exclusive) {
      delete this.filter.EQ[TYPE]
    }

    this.model = models[type]
    this.prefixedOrderBy = {
      property: table.prefixKey({
        type,
        key: orderBy.property || table.rangeKey
      }),
      desc: orderBy.desc
    }

    for (let operator in this.filter) {
      if (operator in OPERATORS) {
        this.prefixedFilter[operator] = table.prefixPropertiesForType(type, this.filter[operator])
      }
    }

    this._configureBuilder()
    this._addConditions()
    this._debug(`running ${this.opType}`)
  }

  private _debug = (...args) => {
    args.unshift(`search:${this.opType}`)
    debug(...args)
  }

  public exec = async () => {
    let result
    const {
      builder,
      models,
      orderBy,
      sortedByDB,
      filter,
      after,
      limit,
      itemToPosition,
      queryProp,
      index
    } = this

    if (sortedByDB) {
      // results come back filtered, post-processed
      result = await this.collectInBatches()
    } else {
      // scan the whole table,
      // otherwise we can't apply filter, orderBy
      result = await exec(builder)
      await this._postProcessResult(result)
      result.Items = this._filterResults(result.Items)
    }

    let items = result.Items
    if (!sortedByDB) {
      items = sortResults({
        results: items,
        orderBy
      })
    }

    if (after) {
      // if we're running a scan
      // we need to do pagination in memory
      const idx = items.map(this.table.toDBFormat).findIndex(item => {
        for (let prop in after) {
          if (!deepEqual(after[prop], item[prop])) {
            return false
          }
        }

        return true
      })

      if (idx !== -1) {
        items = items.slice(idx + 1)
      }
    }

    let startPosition
    if (items.length) {
      startPosition = this.itemToPosition(items[0])
    } else {
      startPosition = after && this.itemToPosition(after)
    }

    let endPosition
    if (!orderBy || orderBy.property === queryProp) {
      if (items.length <= limit) {
        endPosition = getStartKey(builder)
      }
    }

    if (items.length && !endPosition) {
      const length = Math.min(limit, items.length)
      endPosition = itemToPosition(items[length - 1])
    }

    if (items.length > limit) {
      items = items.slice(0, limit)
    }

    return {
      items,
      startPosition,
      endPosition,
      index,
      itemToPosition
    }
  }

  collectInBatches = async () => {
    const { models, table, filter, limit, index, builder } = this

    // limit how many items dynamodb iterates over before filtering
    // this is different from the sql-like notion of limit

    let batchLimit = limit
    if (!isEmpty(filter)) {
      batchLimit = limit * 2
      if (batchLimit < 10) batchLimit = 10
    }

    builder.limit(batchLimit)

    const getNextBatch = async (started:boolean) => {
      const promiseBatch = started ? exec(builder, 'continue') : exec(builder)
      const batch = await promiseBatch
      await this._postProcessResult(batch)
      return batch
    }

    const result = {
      ScannedCount: 0,
      Items: []
    }

    let started = false
    do {
      let batch = await getNextBatch(started)
      started = true
      if (batch.Count) {
        result.ScannedCount += batch.ScannedCount
        result.Items = result.Items.concat(this._filterResults(resultsToJson(batch.Items)))
      }

      if (!batch.LastEvaluatedKey) break
    } while (result.Items.length < limit && builder.canContinue())

    return result
  }

  _filterResults = results => {
    const { models, model, filter } = this
    return filterResults({
      models,
      model,
      filter,
      results
    })
  }

  _postProcessResult = async (result) => {
    const { table, index } = this
    if (index && index.projection.ProjectionType !== 'ALL') {
      this._debug('inflating due to use of index')
      if (this.bodyInObjects && result.Items.every(item => item._link)) {
        result.Items = await Promise.all(result.Items.map(table.inflate))
      } else {
        result.Items = await Promise.all(result.Items.map(table.get))
      }
    }
  }

  _addConditions = function () {
    const { prefixedFilter, after, opType, builder, sortedByDB, table, index } = this
    const conditionBuilders = {
      where: builder.where && builder.where.bind(builder),
      filter: builder.filter && builder.filter.bind(builder)
    }

    if (after) {
      if (sortedByDB) {
        builder.startKey(after)
      }
    }

    const comparators = getComparators(opType)
    for (let op in prefixedFilter) {
      let setCondition = comparators[op]
      if (!setCondition) {
        this._debug(`comparator ${op} for op type ${opType} doesn't exist or is not implemented (yet)`)
        continue
      }

      let conditions = prefixedFilter[op]
      for (let property in conditions) {
        if (property in OPERATORS) {
          this._debug('nested operators not support (yet)')
          continue
        }

        if (property === this.queryProp && this.opType === 'query') {
          // specified in key condition
          continue
        }

        if (index && !doesIndexProjectProperty({ index, property })) {
          this._debug(`index ${index.name} doesn't project property ${property}, will filter in memory`)
          continue
        }

        let conditionMethod = !builder.filter || property === this.primaryKeys.rangeKey
          ? 'where'
          : 'filter'

        let conditionBuilder = conditionBuilders[conditionMethod]
        setCondition({
          where: conditionBuilder,
          key: property,
          value: conditions[property]
        })
      }
    }

    return builder
  }

  _configureBuilder = function _configureBuilder () {
    const {
      opType,
      filter,
      orderBy,
      table,
      queryProp,
      index,
      consistentRead,
      sortedByDB
    } = this

    const { EQ } = filter
    const { type } = EQ
    const createBuilder = table[opType]
    let builder
    if (opType === 'query') {
    //   // supported key condition operators:
    //   // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions

      builder = createBuilder(EQ[queryProp])
      if (index) {
        builder.usingIndex(index.name)
      }

      if (sortedByDB) {
        // ordering in DB only makes sense if results
        // are sorted (but maybe in reverse)
        if (orderBy.desc) {
          builder.descending()
        } else {
          builder.ascending()
        }
      }
    } else {
      this._throwIfScanForbidden()
      // sortedByDB = !!orderBy
      builder = createBuilder()
    }

    if (sortedByDB) {
      this._debug('full scan NOT required')
    } else {
      this._throwIfScanForbidden()
      this._debug('full scan required')
      builder.loadAll()
    }

    // indexes cannot be queried with consistent read
    if (consistentRead && !index) {
      builder.consistentRead()
    }

    this.builder = builder
  }

  _throwIfScanForbidden = function () {
    if (!this.forbidScan) return

    const keySchemas = (this.table.indexes || []).concat(this.table.primaryKeys)
      .map(props => pick(props, ['hashKey', 'rangeKey']))

    const hint = `Specify a limit, and a combination of hashKey in the EQ filter and (optionally) rangeKey in orderBy: ${JSON.stringify(keySchemas)}`
    throw new Error(`this table does not allow scans or full reads. ${hint}`)
  }
}

const exec = async (builder, method='exec') => {
  try {
    return await promisify(builder[method].bind(builder))()
  } catch (err) {
    if (err.code === 'ResourceNotFoundException') {
      return {
        Count: 0,
        ScannedCount: 0,
        Items: []
      }
    }

    throw err
  }
}

const getStartKey = builder => {
  return builder.request.ExclusiveStartKey
}

// function usesNonPrimaryKeys ({ model, filter }) {
//   return props.some(prop => !indexed[prop])
// }

const isEmpty = obj => {
  return !obj || Object.keys(obj).length === 0
}

const notNull = val => !!val

export default function (opts) {
  return new FilterOp(opts).exec()
}

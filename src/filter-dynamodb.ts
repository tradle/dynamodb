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
  doesIndexProjectProperty,
  getModelProperties
} from './utils'

import OPERATORS = require('./operators')
import { getComparators } from './comparators'
import { filterResults } from './filter-memory'
import { defaultOrderBy, defaultLimit, minifiedFlag } from './constants'
import { OrderBy, Model, Models, DynogelIndex, FindOpts } from './types'
import Table from './table'

class FilterOp {
  public opts:FindOpts
  public models:Models
  public model:Model
  public filter:any
  public select?:string[]
  public prefixedFilter:any
  public orderBy:OrderBy
  public prefixedOrderBy:OrderBy
  public limit:number
  public checkpoint?: any
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
  constructor (opts:FindOpts) {
    this.opts = opts
    Object.assign(this, opts)
    this.filter = clone(this.filter)
    const {
      table,
      models,
      orderBy=defaultOrderBy,
      limit=defaultLimit,
      checkpoint,
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
  }

  private _debug = (...args) => {
    args.unshift(`search:${this.opType}`)
    debug(...args)
  }

  public exec = async () => {
    this._debug(`running ${this.opType}`)

    let result
    const {
      builder,
      models,
      orderBy,
      sortedByDB,
      filter,
      limit,
      checkpoint,
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

    const asc = !orderBy.desc
    if (checkpoint) {
      // if we're running a scan
      // we need to do pagination in memory
      const idx = items.map(this.table.toDBFormat).findIndex(item => {
        for (let prop in checkpoint) {
          if (!deepEqual(checkpoint[prop], item[prop])) {
            return false
          }
        }

        return true
      })

      if (idx !== -1) {
        items = asc ? items.slice(idx + 1) : items.slice(0, idx - 1)
      }
    }

    let startPosition
    if (items.length) {
      startPosition = itemToPosition(items[0])
    } else {
      startPosition = checkpoint
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
    const { table } = this
    result.Items = result.Items.map(item => table.fromDBFormat(item))
    result.Items = await Promise.all(result.Items.map(this._maybeInflate))
  }

  _maybeInflate = async (resource) => {
    let { table, select, index } = this
    if (!select) {
      select = getModelProperties(this.model)
    }

    const canInflateFromDB = index && index.projection.ProjectionType !== 'ALL'
    const cut = resource[minifiedFlag] || []
    let needsInflate
    if (cut.length) {
      needsInflate = select.some(prop => cut.includes(prop))
    } else if (canInflateFromDB) {
      needsInflate = select.some(prop => !(prop in resource))
    }

    if (needsInflate) {
      if (resource._link && table.objects) {
        return await table.objects.get(resource._link)
      }

      return await table.get(resource)
    }

    return resource
  }

  _addConditions = function () {
    const {
      prefixedFilter,
      checkpoint,
      opType,
      builder,
      sortedByDB,
      table,
      index
    } = this

    const conditionBuilders = {
      where: builder.where && builder.where.bind(builder),
      filter: builder.filter && builder.filter.bind(builder)
    }

    const { hashKey, rangeKey } = index || this
    if (sortedByDB && checkpoint) {
      builder.startKey(checkpoint)
    }

    for (let op in prefixedFilter) {
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

        if (index && !doesIndexProjectProperty({ table, index, property })) {
          this._debug(`index ${index.name} doesn't project property ${property}, will filter in memory`)
          continue
        }

        let comparators = getComparators({ queryInfo: this, property })
        let setCondition = comparators[op]
        if (!setCondition) {
          this._debug(`comparator ${op} for op type ${opType} doesn't exist or is not implemented (yet)`)
          continue
        }

        let conditionMethod = !builder.filter || property === rangeKey
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
      checkpoint,
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
    let builder
    if (opType === 'query') {
    //   // supported key condition operators:
    //   // http://docs.aws.amazon.com/amazondynamodb/latest/developerguide/Query.html#Query.KeyConditionExpressions

      builder = table.table.query(EQ[queryProp])

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
      builder = table.table.scan()
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

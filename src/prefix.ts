import { separator } from './constants'
import { sha256 } from './utils'

function getUniquePrefix (type) {
  return sha256(type).slice(0, 6)
}

function prefixKeys (obj:any, prefix:string, skip:string[]=[]) {
  const prefixed = {}
  for (let key in obj) {
    if (skip.includes(key)) {
      prefixed[key] = obj[key]
    } else {
      prefixed[prefixString(key, prefix)] = obj[key]
    }
  }

  return prefixed
}

function prefixValues (obj:any, prefix:string, skip:string[]=[]) {
  const prefixed = {}
  for (let key in obj) {
    if (skip.includes(key)) {
      prefixed[key] = obj[key]
    } else {
      prefixed[key] = prefixString(obj[key], prefix)
    }
  }

  return prefixed
}

function unprefixKeys (obj:any, prefix:string, skip:string[]=[]) {
  const unprefixed = {}
  for (let key in obj) {
    if (skip.includes(key)) {
      unprefixed[key] = obj[key]
    } else {
      unprefixed[unprefixString(key, prefix)] = obj[key]
    }
  }

  return unprefixed
}

function prefixString (str, prefix) {
  return prefix + separator + str
}

function unprefixString (str, prefix) {
  const start = prefix + separator
  if (!str.startsWith(start)) {
    throw new Error(`expected string "${str}" to start with ${start}`)
  }

  return str.slice(start.length)
}

export {
  prefixKeys,
  unprefixKeys,
  prefixValues,
  getUniquePrefix,
  prefixString,
  unprefixString
}

/** 词项统计：从 full_term_stats 取 DF，算平滑 IDF。 */
import { DatabaseSync } from 'node:sqlite'
import { databaseOptions } from './connection.mjs'
import { termBigrams } from './term-graph.mjs'

let handle = null
let corpusN = 0
let dfStmt = null
const dfCache = new Map()

function open() {
  if (handle) return handle
  const dbPath = databaseOptions()?.dbPath
  if (!dbPath) return null
  try {
    handle = new DatabaseSync(dbPath, { readOnly: true })
    corpusN = Number(handle.prepare('select fragment_count n from full_corpus_stats').get()?.n) || 0
    dfStmt = handle.prepare('select document_frequency df from full_term_stats where term = ?')
    return handle
  } catch {
    handle = null
    return null
  }
}

export function corpusSize() {
  open()
  return corpusN
}

/** 多字词按 bigram 取最小 DF（上界近似）。 */
export function dfOf(term) {
  if (!open() || !dfStmt) return 0
  const key = String(term || '').trim()
  if (!key) return 0
  if (dfCache.has(key)) return dfCache.get(key)
  // 先查整词（英文/数字 token 与双字中文都以整词入 postings）
  const exact = Number(dfStmt.get(key)?.df) || 0
  if (exact > 0) {
    dfCache.set(key, exact)
    return exact
  }
  // 长中文词没有整词条目，退回 bigram 最小值（上界近似）
  const grams = termBigrams(key)
  let df = Infinity
  for (const gram of grams) {
    const value = Number(dfStmt.get(gram)?.df) || 0
    df = Math.min(df, value)
  }
  const result = Number.isFinite(df) ? df : 0
  dfCache.set(key, result)
  return result
}

export function idfOf(term, { kappa = 1 } = {}) {
  const n = corpusSize()
  if (!n) return 0
  const k = Math.max(0, Number(kappa) || 0)
  return Math.log(1 + n / (dfOf(term) + k))
}

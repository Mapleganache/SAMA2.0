/** 诊断词共现图：从 full_postings 离线抽边，供检索树邻域扩展。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
export const TERM_GRAPH_FILE = path.join(here, 'term-graph.json')

export const LEXICON = [
  '爬行', '导轨', '润滑', '油品', '润滑脂', '添加剂', '抗磨', '乳化', '进水', '间隙',
  '供油', '节流', '污染', '中心孔', '顶尖', '皂液', '油漆', '汽油', '抗水性',
  '抱轴', '烧伤', '粗糙', '波纹', '振纹', '超差', '齿面', '发热', '温升', '过热',
  '发烫', '卡滞', '抖动', '滞涩', '油膜', '机械油', '导轨油', '静压', '动静压',
  '轴承', '主轴', '液压', '油腔', '低温', '抗乳化', '补脂', '密封', '丝杠',
  '咬毛', '拉毛',
]

export function termBigrams(term) {
  const compact = String(term || '').toLowerCase().replace(/\s+/g, '')
  if (compact.length < 2) return []
  if (compact.length === 2) return [compact]
  const grams = []
  for (let i = 0; i < compact.length - 1; i += 1) grams.push(compact.slice(i, i + 2))
  return [...new Set(grams)]
}

export function fragmentIdsForTerm(db, term) {
  const grams = termBigrams(term)
  if (!grams.length) return new Set()
  const stmt = db.prepare('SELECT fragment_id FROM full_postings WHERE term = ?')
  let ids = null
  for (const gram of grams) {
    const next = new Set(stmt.all(gram).map((row) => row.fragment_id))
    ids = ids ? intersect(ids, next) : next
    if (!ids.size) return ids
  }
  return ids
}

export function buildTermGraph(db, options = {}) {
  const lexicon = unique((options.lexicon || LEXICON).map((item) => String(item || '').trim()).filter((item) => item.length >= 2))
  const minCo = Math.max(1, Number(options.minCo) || 2)
  const minPmi = Number.isFinite(Number(options.minPmi)) ? Number(options.minPmi) : 1.2
  const maxNbr = Math.max(1, Number(options.maxNbr) || 10)
  const N = Number(db.prepare('SELECT fragment_count FROM full_corpus_stats').get()?.fragment_count) || 1
  const sets = new Map()
  const df = new Map()
  for (const term of lexicon) {
    const ids = fragmentIdsForTerm(db, term)
    sets.set(term, ids)
    df.set(term, ids.size)
  }
  const buckets = new Map()
  const add = (from, to, co, pmi) => {
    if (!buckets.has(from)) buckets.set(from, [])
    buckets.get(from).push({ term: to, co, pmi })
  }
  for (let i = 0; i < lexicon.length; i += 1) {
    for (let j = i + 1; j < lexicon.length; j += 1) {
      const a = lexicon[i]
      const b = lexicon[j]
      const left = sets.get(a)
      const right = sets.get(b)
      if (!left.size || !right.size) continue
      const co = intersectSize(left, right)
      if (co < minCo) continue
      const pmi = Math.log((co * N) / Math.max(1, df.get(a) * df.get(b)))
      if (pmi < minPmi) continue
      add(a, b, co, pmi)
      add(b, a, co, pmi)
    }
  }
  const nodes = {}
  for (const [term, nbrs] of buckets) {
    nodes[term] = nbrs
      .sort((a, b) => b.pmi * Math.log(1 + b.co) - a.pmi * Math.log(1 + a.co) || b.co - a.co)
      .slice(0, maxNbr)
      .map((row) => ({ term: row.term, co: row.co, pmi: Number(row.pmi.toFixed(4)) }))
  }
  return {
    version: 1,
    builtAt: new Date().toISOString(),
    fragmentCount: N,
    fingerprint: graphFingerprint(db),
    minCo,
    minPmi,
    maxNbr,
    nodeCount: Object.keys(nodes).length,
    nodes,
  }
}

export function graphFingerprint(db) {
  return Number(db.prepare('SELECT count(*) AS n FROM full_postings').get()?.n) || 0
}

export function writeTermGraph(graph, file = TERM_GRAPH_FILE) {
  fs.writeFileSync(file, `${JSON.stringify(graph, null, 2)}\n`)
  return file
}

export function loadTermGraph(file = TERM_GRAPH_FILE, expectedFingerprint) {
  const target = file || TERM_GRAPH_FILE
  if (!fs.existsSync(target)) return emptyGraph()
  try {
    const data = JSON.parse(fs.readFileSync(target, 'utf8'))
    if (!data?.nodes || typeof data.nodes !== 'object') return emptyGraph()
    if (expectedFingerprint != null && Number(data.fingerprint) !== Number(expectedFingerprint)) {
      console.warn('term-graph 与当前库不一致，请重建')
      return emptyGraph()
    }
    return data
  } catch {
    return emptyGraph()
  }
}

let ensurePromise = null
export async function ensureTermGraph(dbPath, file = TERM_GRAPH_FILE) {
  if (!dbPath) return loadTermGraph(file)
  if (ensurePromise) return ensurePromise
  ensurePromise = (async () => {
    const { DatabaseSync } = await import('node:sqlite')
    const db = new DatabaseSync(dbPath, { readOnly: true })
    try {
      db.exec('PRAGMA query_only=ON')
      const fingerprint = graphFingerprint(db)
      const loaded = loadTermGraph(file, fingerprint)
      if (loaded.nodeCount) return loaded
      const graph = buildTermGraph(db)
      writeTermGraph(graph, file)
      return graph
    } finally {
      db.close()
    }
  })()
  try {
    return await ensurePromise
  } catch (error) {
    ensurePromise = null
    console.warn(`term-graph 重建失败：${error.message}`)
    return loadTermGraph(file)
  }
}

export function corpusNeighbors(term, graph) {
  const nodes = graph?.nodes || {}
  const key = String(term || '').trim()
  if (!key) return []
  const found = new Map()
  const take = (node) => {
    for (const row of nodes[node] || []) {
      const name = String(row.term || '').trim()
      if (!name || name === key) continue
      const score = Number(row.pmi) * Math.log(1 + Number(row.co) || 0)
      if (!found.has(name) || score > found.get(name)) found.set(name, score)
    }
  }
  if (nodes[key]) take(key)
  for (const node of Object.keys(nodes)) {
    if (node === key) continue
    if (key.includes(node) || (node.length >= 2 && node.includes(key))) take(node)
  }
  return [...found.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name)
}

function emptyGraph() {
  return { version: 1, fingerprint: 0, nodes: {}, nodeCount: 0 }
}

function intersect(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  const out = new Set()
  for (const item of small) if (large.has(item)) out.add(item)
  return out
}

function intersectSize(a, b) {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let n = 0
  for (const item of small) if (large.has(item)) n += 1
  return n
}

function unique(items) {
  return [...new Set(items)]
}

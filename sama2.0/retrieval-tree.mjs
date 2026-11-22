/**
 * 多跳图扩展检索树：分温 Softmax 入口 → beam 扩展 → ΔG 软停机。
 * s_vec 默认词频稀疏余弦；图邻域来自 BRIDGES + 共现图 + 命中抽词。
 */
import { resolveScoreVec } from './embed.mjs'
import { corpusNeighbors, ensureTermGraph, loadTermGraph } from './sama-sqlite/term-graph.mjs'

export const LANE_TEMPS = [0.35, 0.5, 0.85, 1.0, 0.95]
export const TREE_TOP_K = 3
export const TREE_BEAM_K = 3
export const TREE_HOPS = 2
export const TREE_GAMMA = 0.6
export const TREE_HOP_COST = 0.15
export const TREE_ALPHA = 0.5
export const TREE_RET_BUDGET = 12
export const TREE_HOP_FUSE = 16
export const TREE_ENTRY_RETRY = 3
export const TREE_MMR_LAMBDA = 0.5
export const OVERLAP_LIMIT = 0.5
export const PATH_OVERLAP_LIMIT = 0.8
export const BEAM_ALLOWED = [3, 5, 7]

const BRIDGES = [
  { re: /粗糙|波纹|振纹|密纹|精度|超差|齿面|烧伤/, terms: ['爬行', '导轨', '润滑', '油品'] },
  { re: /抱轴|抱死|拉毛/, terms: ['油品', '间隙', '供油', '添加剂', '静压', '动静压'] },
  { re: /咬毛|顶尖|中心孔/, terms: ['润滑脂', '皂液', '中心孔'] },
  { re: /发热|温升|过热|发烫/, terms: ['油品', '间隙', '供油', '润滑'] },
  { re: /乳化|起泡|变质/, terms: ['进水', '抗水性', '换油'] },
  { re: /爬行|卡滞|抖动/, terms: ['导轨', '润滑', '油品'] },
]

const MECHANISM = ['爬行', '导轨', '润滑', '油品', '润滑脂', '添加剂', '抗磨', '乳化', '进水', '间隙', '供油', '节流', '污染', '中心孔', '顶尖', '皂液', '油漆', '汽油', '抗水性']
const ANTI_THERMAL = ['油品', '润滑脂', '导轨', '添加剂', '抗磨', '供油']

const KG = buildStaticKg()
let termGraph = null

function graph() {
  if (!termGraph) termGraph = loadTermGraph()
  return termGraph
}

export function resetTermGraph(next = null) {
  termGraph = next
}

export const TREE_HEADER = 'SQLite全量资料（reference，开发参考；未经维修专家复核）。资料中的条件、历史处理和数值均不是本机结论；缺失不得补造。'

export function laneTemperature(config, index) {
  const list = Array.isArray(config?.laneTemps) && config.laneTemps.length ? config.laneTemps : LANE_TEMPS
  return Number(list[index % list.length]) || LANE_TEMPS[index % LANE_TEMPS.length]
}

export function clampBeamK(value) {
  const n = Number(value)
  const raw = Number.isFinite(n) && n > 0 ? n : TREE_BEAM_K
  return BEAM_ALLOWED.reduce((best, item) => (Math.abs(item - raw) < Math.abs(best - raw) ? item : best))
}

export function tokensOf(text) {
  const compact = String(text || '').toLowerCase().replace(/\s+/g, '')
  const words = compact.split(/[^\p{L}\p{N}]+/u).filter((item) => item.length >= 2)
  const grams = []
  for (let i = 0; i < compact.length - 1 && grams.length < 40; i += 1) grams.push(compact.slice(i, i + 2))
  return [...new Set([...words, ...grams])]
}

export function jaccard(a, b) {
  const left = new Set(tokensOf(a))
  const right = new Set(tokensOf(b))
  if (!left.size && !right.size) return 1
  let hit = 0
  for (const item of left) if (right.has(item)) hit += 1
  return hit / (left.size + right.size - hit)
}

export function bridgeTerms(query) {
  const text = String(query || '')
  const scored = new Map()
  for (const row of BRIDGES) {
    const hit = text.match(row.re)
    if (!hit) continue
    for (const term of row.terms) {
      const score = hit[0].length + term.length
      scored.set(term, Math.max(scored.get(term) || 0, score))
    }
  }
  return [...scored.entries()].sort((a, b) => b[1] - a[1]).map(([term]) => term)
}

export function kgNeighbors(term) {
  const key = String(term || '').trim()
  if (!key) return []
  const found = new Set()
  const direct = KG.get(key)
  if (direct) for (const item of direct) found.add(item)
  for (const [node, nbrs] of KG) {
    if (node === key) continue
    if (key.includes(node) || node.includes(key)) for (const item of nbrs) found.add(item)
  }
  for (const row of BRIDGES) {
    if (row.re.test(key)) for (const item of row.terms) found.add(item)
  }
  for (const item of corpusNeighbors(key, graph())) found.add(item)
  found.delete(key)
  return [...found]
}

export function extraTokens(origin, query) {
  const base = new Set(tokensOf(origin))
  return tokensOf(query).filter((item) => !base.has(item))
}

export function firstQueryForLane(origin, index) {
  const text = String(origin || '').trim()
  const bridges = bridgeTerms(text)
  const slot = ((Number(index) || 0) % 5 + 5) % 5
  if (slot === 0) return text
  if (slot === 1) return joinQuery([text, ...bridges.slice(0, 4)])
  if (slot === 2) return joinQuery(bridges.length ? bridges : ['润滑', '油品', '间隙'])
  if (slot === 3) return joinQuery(['润滑脂', '油品', '添加剂', ...bridges.slice(-2)])
  return joinQuery([...ANTI_THERMAL, ...bridges.filter((term) => !/热/.test(term))])
}

export function diversifyLaneQueries(origin, count, start = 0) {
  const queries = Array.from({ length: count }, (_, offset) => firstQueryForLane(origin, start + offset))
  for (let i = 0; i < queries.length; i += 1) {
    const slot = ((start + i) % 5 + 5) % 5
    if (slot === 0) continue
    let guard = 0
    while (guard < 4 && collides(queries, i, origin)) {
      queries[i] = joinQuery([queries[i], MECHANISM[(i + guard) % MECHANISM.length]])
      guard += 1
    }
  }
  return queries
}

/** 分温 Softmax / MMR 生成各路第 0 步入口查询。 */
export function buildLaneEntries(origin, options = {}) {
  const count = Math.max(1, Number(options.count) || 5)
  const start = Number(options.start) || 0
  const seedBase = Number(options.seedBase) || 1000
  const mode = String(options.entryMode || options.treeEntryMode || 'softmax').toLowerCase() === 'mmr' ? 'mmr' : 'softmax'
  const retryLimit = Math.max(0, Number(options.retry ?? options.treeEntryRetry) || TREE_ENTRY_RETRY)
  const temps = Array.isArray(options.temps) && options.temps.length
    ? options.temps
    : Array.isArray(options.laneTemps) && options.laneTemps.length
      ? options.laneTemps
      : LANE_TEMPS
  const pool = entryCandidatePool(origin, options.priorBeta ?? options.treePriorBeta)
  if (mode === 'mmr') {
    const picked = pickMmr(pool, count, options.mmrLambda ?? options.treeMmrLambda ?? TREE_MMR_LAMBDA, origin)
    const ordered = picked
      .slice()
      .sort((a, b) => b.prior - a.prior)
      .map((row, index) => ({
        entryQuery: row.q,
        tau: Number(temps[(start + index) % temps.length]) || LANE_TEMPS[index % LANE_TEMPS.length],
        seed: seedBase + start + index,
        entryMode: 'mmr',
        prior: row.prior,
      }))
    return ordered
  }

  const chosen = []
  const entries = []
  for (let i = 0; i < count; i += 1) {
    const index = start + i
    const tau = Number(temps[index % temps.length]) || LANE_TEMPS[index % LANE_TEMPS.length]
    const seed = seedBase + index
    const rng = mulberry32(seed >>> 0)
    // 低温路近似 MAP：稳在最高先验（通常是原句），对应规格「0.35 → 原词」。
    let q = tau <= 0.4 ? argmaxPrior(pool) : sampleSoftmax(pool, tau, rng)
    let retry = 0
    while (retry < retryLimit && entryCollides(q, chosen, origin)) {
      q = tau <= 0.4
        ? firstQueryForLane(origin, index)
        : sampleSoftmax(pool, tau, mulberry32((seed + 1009 * (retry + 1)) >>> 0))
      retry += 1
    }
    if (entryCollides(q, chosen, origin)) q = firstQueryForLane(origin, index)
    chosen.push(q)
    const prior = pool.find((row) => row.q === q)?.prior ?? lexicalPrior(origin, q)
    entries.push({ entryQuery: q, tau, seed, entryMode: 'softmax', prior })
  }
  return entries
}

export function pathScore(hopScores, gamma = TREE_GAMMA) {
  return hopScores.reduce((sum, value, index) => sum + Number(value || 0) * gamma ** index, 0)
}

export function scorePathSet(origin, terms, docs, alpha = TREE_ALPHA, scoreVec) {
  const textT = joinQuery([...(terms || []), ...(docs || []).map((doc) => `${doc.title || ''} ${doc.snippet || ''}`)])
  const sVec = typeof scoreVec === 'function'
    ? clamp01(scoreVec(origin, terms, docs))
    : jaccard(origin, textT || joinQuery(terms))
  const raw = Math.max(0, ...(docs || []).map((doc) => Number(doc.score) || 0), 0)
  const sLex = raw > 0 ? raw / (raw + 5) : sVec * 0.5
  const a = clamp01(alpha)
  return clamp01(a * sVec + (1 - a) * sLex)
}

/** 扩展增益只看新文档相对问题的最佳相关度，避免整条路径文本把余弦稀释掉。 */
export function bestDocScore(origin, docs, scoreVec) {
  return (docs || []).reduce((best, doc) => Math.max(best, scorePathSet(origin, [], [doc], 1, scoreVec)), 0)
}

export function nextPathScore(origin, currentS, newDocs, scoreVec) {
  const prev = Number(currentS) || 0
  const docScore = bestDocScore(origin, newDocs, scoreVec)
  const S_n = Math.max(prev, docScore)
  // 机理文档相对题面的余弦常低于种子篇。若 gain 取 S_n-π.S，真实库上仍恒为 0。
  // ΔG=γ^{n-1}(gain-λ) 不变；gain 改为这一跳新文档自己的相关度。
  return { docScore, S_n, gain: docScore }
}

export function nextQueryFromHits(origin, hits) {
  const found = []
  const blob = (hits || []).map((hit) => `${hit.title || ''} ${hit.snippet || ''}`).join(' ')
  for (const word of MECHANISM) {
    if (blob.includes(word) && !String(origin || '').includes(word) && !found.includes(word)) found.push(word)
  }
  if (found.length) return found.slice(0, 4).join(' ')
  const extras = extraTokens(origin, blob).filter((item) => item.length >= 2 && !/热机|热变|温升/.test(item))
  return extras.slice(0, 4).join(' ')
}

export function normalizeRecord(row) {
  if (!row) return { id: '', title: '', snippet: '', score: 0 }
  if (row.kind === 'curated') {
    const data = row.data || {}
    return {
      id: data.citation_row != null ? `sqlite_curated:${data.citation_row}` : String(data.id || ''),
      title: data.title || data.id || '',
      snippet: String(data.summary || data.structure_requirement || ''),
      score: Number(data.score) || 0,
    }
  }
  if (row.kind === 'archive_case') {
    return {
      id: `sqlite_case:${row.citation_row}`,
      title: row.title || row.id || '',
      snippet: `${row.symptom || ''} ${row.possible_cause || ''} ${row.action || ''}`,
      score: Number(row.score) || 0,
    }
  }
  return {
    id: row.citation_row != null ? `sqlite_fragment:${row.citation_row}` : String(row.id || ''),
    title: row.title || row.id || '',
    snippet: String(row.clean_text || row.raw_text || '').slice(0, 500),
    score: Number(row.score) || 0,
  }
}

/**
 * ExpandTree：从 t0 做 beam 扩展，用 ΔG = γ^{n-1}((S_n-S_{n-1})_+ - λ_hop) 停机。
 * hops 仅作兼容保留，业务停机不依赖它。
 */
export function runRetrievalTree({
  origin,
  firstQuery,
  hops = TREE_HOPS,
  topK = TREE_TOP_K,
  beamK,
  gamma = TREE_GAMMA,
  hopCost = TREE_HOP_COST,
  alpha = TREE_ALPHA,
  retBudget = TREE_RET_BUDGET,
  hopFuse = TREE_HOP_FUSE,
  tauLane = null,
  entryMode = 'softmax',
  embedMode,
  scoreVec,
  searchFn,
} = {}) {
  const t0 = String(firstQuery || origin || '').trim()
  const x = String(origin || t0).trim()
  if (!t0) return emptyTree(t0, { tauLane, entryMode })

  const search = searchFn || defaultSearch
  const vec = typeof scoreVec === 'function' ? scoreVec : resolveScoreVec(embedMode)
  const K = clampBeamK(beamK ?? topK)
  const γ = Number(gamma) > 0 && Number(gamma) <= 1 ? Number(gamma) : TREE_GAMMA
  const λ = Math.max(0, Number(hopCost) || 0)
  const budget = { left: Math.max(1, Number(retBudget) || TREE_RET_BUDGET), used: 0 }
  const fuse = Math.max(2, Number(hopFuse) || TREE_HOP_FUSE)
  // 兼容旧调用：若显式传入很小的 hops，仍允许作为保险丝上限之一
  const hardCap = Math.min(fuse, Number(hops) > 0 && Number(hops) < fuse && hops !== TREE_HOPS ? Number(hops) : fuse)

  const seedDocs = takeTop(doSearch(search, t0, K, budget, new Set()), K)
  const bridge = bridgeTerms(t0)
  const seedTerms = bridge.length ? bridge.slice(0, 4) : splitTerms(t0)
  const seedS = scorePathSet(x, seedTerms, seedDocs, alpha, vec)
  let beam = [
    {
      terms: seedTerms.length ? seedTerms : [t0],
      docs: seedDocs,
      S: seedS,
      G: seedS,
      delta: seedS,
      lastQuery: t0,
      hops: [{ query: t0, records: seedDocs, S: seedS }],
    },
  ]

  let n = 1
  let hop2Query = ''
  while (n < hardCap && budget.left > 0) {
    const cands = []
    for (const π of beam) {
      const last = π.terms[π.terms.length - 1] || t0
      const queryFromT = joinQuery(π.terms)
      const hitDocs = takeTop(doSearch(search, queryFromT, K, budget, idSet(π.docs)), K)
      const fromHits = termsFromHits(hitDocs, π.terms)
      const fromKg = [...kgNeighbors(last), ...π.terms.flatMap((term) => kgNeighbors(term))]
      const nbrs = uniqueTerms([...fromHits, ...fromKg]).filter((c) => !π.terms.includes(c))
      for (const c of nbrs.slice(0, Math.max(6, K * 2))) {
        const T2 = [...π.terms, c]
        const q2 = joinQuery(T2)
        if (!q2 || q2 === π.lastQuery) continue
        const newDocs = takeTop(doSearch(search, q2, K, budget, idSet(π.docs)), K)
        if (!newDocs.length) continue
        const docs2 = uniqueRecords([...π.docs, ...newDocs])
        const { S_n, gain } = nextPathScore(x, π.S, newDocs, vec)
        const delta = γ ** (n - 1) * (gain - λ)
        if (delta <= 0) continue
        cands.push({
          terms: T2,
          docs: docs2,
          S: S_n,
          G: π.G + delta,
          delta,
          lastQuery: q2,
          hops: [...π.hops, { query: q2, records: newDocs, S: S_n }],
        })
      }
    }
    if (!cands.length) break
    const next = diversifyBeam(cands.sort((a, b) => b.G - a.G || b.S - a.S), K)
    if (!next.length) break
    if (n === 1) hop2Query = next[0]?.lastQuery || ''
    beam = next
    n += 1
  }

  const best = beam.slice().sort((a, b) => b.G - a.G || b.S - a.S)[0]
  const records = uniqueRecords(best?.docs || seedDocs).slice(0, 4)
  const score = Number(best?.G) || 0
  return {
    query: t0,
    entryQuery: t0,
    entryMode,
    tauLane,
    hop2Query: hop2Query || nextQueryFromHits(x, seedDocs),
    path: best?.terms || seedTerms,
    hops: best?.hops || [{ query: t0, records: seedDocs, S: seedS }],
    records,
    score,
    hopsUsed: best?.hops?.length || 1,
    text: formatTree({
      t0,
      tauLane,
      entryMode,
      path: best?.terms || seedTerms,
      hops: best?.hops || [{ query: t0, records: seedDocs, S: seedS }],
      score,
      G: score,
    }),
  }
}

export async function runSqliteTree(options) {
  const { searchRecords } = await import('./sama-sqlite/library.mjs')
  const { databaseOptions } = await import('./sama-sqlite/connection.mjs')
  resetTermGraph(await ensureTermGraph(databaseOptions()?.dbPath))
  return runRetrievalTree({
    ...options,
    searchFn: (query, extra) => {
      try {
        const result = searchRecords(query, { limit: extra?.limit || TREE_TOP_K })
        return (result.records || []).map(normalizeRecord).filter((row) => row.id && !extra?.excludeIds?.has(row.id))
      } catch {
        return []
      }
    },
  })
}

export function laneSearchHint(index, firstQuery) {
  const slot = ((Number(index) || 0) % 5 + 5) % 5
  const lines = [
    '你的检索入口偏原词：第一次查询尽量接近用户原文，不要改写成热变形。',
    '你的检索入口偏中间层：优先查爬行、导轨、润滑、油品这类可能的机理，而不是只查表面结果词。',
    '你的检索入口必须与原词错开：改写查询后再搜，禁止与其他路使用同一组关键词。',
    '你的检索入口走润滑与油品链：油品、脂种、添加剂、供油，不要把热机当成已经确认的主因。',
    '你是反方：专门找不是热变形、不是砂轮钝化的资料。题面写了热机只说明暴露时机。',
  ]
  return `本路第一次查询词：${firstQuery}\n${lines[slot]}`
}

function buildStaticKg() {
  const map = new Map()
  const link = (a, b) => {
    if (!a || !b || a === b) return
    if (!map.has(a)) map.set(a, new Set())
    if (!map.has(b)) map.set(b, new Set())
    map.get(a).add(b)
    map.get(b).add(a)
  }
  for (const row of BRIDGES) {
    for (let i = 0; i < row.terms.length; i += 1) {
      for (let j = i + 1; j < row.terms.length; j += 1) link(row.terms[i], row.terms[j])
    }
  }
  for (let i = 0; i < MECHANISM.length; i += 1) {
    for (let j = i + 1; j < Math.min(i + 3, MECHANISM.length); j += 1) link(MECHANISM[i], MECHANISM[j])
  }
  return map
}

function entryCandidatePool(origin, priorBeta = 0.5) {
  const text = String(origin || '').trim()
  const rows = []
  const push = (q, prior) => {
    const query = String(q || '').trim()
    if (!query) return
    const existing = rows.find((row) => row.q === query)
    if (existing) {
      existing.prior = Math.max(existing.prior, prior)
      return
    }
    rows.push({ q: query, prior: clamp01(prior) })
  }
  push(text, 1)
  for (let i = 1; i < 5; i += 1) {
    const q = firstQueryForLane(text, i)
    const lex = lexicalPrior(text, q)
    const slotPrior = clamp01(0.7 - i * 0.08 + 0.25 * lex)
    push(q, mixPrior(lex, slotPrior, priorBeta))
  }
  for (const term of bridgeTerms(text)) {
    push(joinQuery([term]), mixPrior(lexicalPrior(text, term), 0.42, priorBeta))
    push(joinQuery([text, term]), mixPrior(lexicalPrior(text, joinQuery([text, term])), 0.55, priorBeta))
  }
  for (const term of MECHANISM.slice(0, 8)) {
    if (text.includes(term)) continue
    push(term, mixPrior(lexicalPrior(text, term), 0.28, priorBeta))
  }
  return rows
}

function mixPrior(lex, rule, beta) {
  const b = clamp01(Number(beta) || 0.5)
  return clamp01(b * lex + (1 - b) * rule)
}

function lexicalPrior(origin, query) {
  return clamp01(0.35 + 0.65 * jaccard(origin, query))
}

function sampleSoftmax(pool, tau, rng) {
  if (!pool.length) return ''
  const t = Math.max(0.05, Number(tau) || 0.5)
  const weights = pool.map((row) => Math.exp(Number(row.prior || 0) / t))
  const sum = weights.reduce((a, b) => a + b, 0) || 1
  let r = rng() * sum
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i]
    if (r <= 0) return pool[i].q
  }
  return pool[pool.length - 1].q
}

function argmaxPrior(pool) {
  if (!pool.length) return ''
  return pool.slice().sort((a, b) => b.prior - a.prior || a.q.length - b.q.length)[0].q
}

function pickMmr(pool, count, lambda, origin) {
  const λ = clamp01(Number(lambda) ?? TREE_MMR_LAMBDA)
  const selected = []
  const rest = pool.slice()
  while (selected.length < count && rest.length) {
    let best = null
    let bestScore = -Infinity
    for (const row of rest) {
      const rel = jaccard(row.q, origin) * 0.5 + row.prior * 0.5
      const red = selected.length ? Math.max(...selected.map((item) => jaccard(row.q, item.q))) : 0
      const score = (1 - λ) * rel - λ * red
      if (score > bestScore) {
        bestScore = score
        best = row
      }
    }
    if (!best) break
    selected.push(best)
    const idx = rest.indexOf(best)
    if (idx >= 0) rest.splice(idx, 1)
  }
  while (selected.length < count && pool.length) {
    selected.push(pool[selected.length % pool.length])
  }
  return selected
}

function entryCollides(query, chosen, origin) {
  if (!query) return true
  if (chosen.some((other) => jaccard(query, other) > OVERLAP_LIMIT)) return true
  if (chosen.length && jaccard(query, origin) > OVERLAP_LIMIT && extraTokens(origin, query).length < 1) {
    return chosen.some((other) => jaccard(other, origin) > OVERLAP_LIMIT)
  }
  return false
}

function diversifyBeam(sorted, K) {
  const out = []
  for (const π of sorted) {
    if (out.length >= K) break
    const text = joinQuery(π.terms)
    if (out.some((other) => jaccard(text, joinQuery(other.terms)) > PATH_OVERLAP_LIMIT)) continue
    out.push(π)
  }
  return out.length ? out : sorted.slice(0, K)
}

function doSearch(search, query, limit, budget, excludeIds) {
  if (!query || budget.left <= 0) return []
  budget.left -= 1
  budget.used += 1
  return search(query, { limit, excludeIds }) || []
}

function termsFromHits(hits, already) {
  const blob = (hits || []).map((hit) => `${hit.title || ''} ${hit.snippet || ''}`).join(' ')
  const have = new Set(already || [])
  const found = []
  for (const word of MECHANISM) {
    if (blob.includes(word) && !have.has(word) && !found.includes(word)) found.push(word)
  }
  for (const extra of extraTokens(joinQuery(already), blob)) {
    if (extra.length >= 2 && !have.has(extra) && !found.includes(extra) && !/热机|热变/.test(extra)) found.push(extra)
  }
  return found.slice(0, 8)
}

function splitTerms(query) {
  return String(query || '')
    .split(/[\s，,。；;！!？?\n]+/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function uniqueTerms(items) {
  const seen = new Set()
  const out = []
  for (const item of items || []) {
    const term = String(item || '').trim()
    if (!term || seen.has(term)) continue
    seen.add(term)
    out.push(term)
  }
  return out
}

function collides(queries, index, origin) {
  const current = queries[index]
  if (jaccard(current, origin) > OVERLAP_LIMIT && extraTokens(origin, current).length < 2) return true
  return queries.some((other, otherIndex) => otherIndex !== 0 && otherIndex !== index && jaccard(current, other) > OVERLAP_LIMIT)
}

function joinQuery(parts) {
  const seen = new Set()
  const out = []
  for (const part of parts || []) {
    for (const piece of String(part || '').split(/\s+/)) {
      const token = piece.trim()
      if (!token || seen.has(token)) continue
      seen.add(token)
      out.push(token)
    }
  }
  return out.join(' ')
}

function idSet(docs) {
  return new Set((docs || []).map((doc) => doc.id).filter(Boolean))
}

function takeTop(rows, topK) {
  return (rows || []).filter((row) => row?.id).slice(0, topK)
}

function uniqueRecords(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows || []) {
    if (!row?.id || seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

function emptyTree(query, extra = {}) {
  return {
    query,
    entryQuery: query,
    entryMode: extra.entryMode || 'softmax',
    tauLane: extra.tauLane ?? null,
    hop2Query: '',
    path: [],
    hops: [],
    records: [],
    score: 0,
    hopsUsed: 0,
    text: '',
  }
}

function formatTree({ t0, tauLane, entryMode, path, hops, score, G }) {
  if (!hops?.length) return ''
  const tauText = tauLane == null ? '' : `；路温 ${Number(tauLane).toFixed(2)}`
  const lines = [
    TREE_HEADER,
    `本路检索树（入口：${t0}；模式 ${entryMode || 'softmax'}；路径 ${joinQuery(path)}；G ${Number(G ?? score).toFixed(3)}${tauText}）。跳数由 ΔG 停机，不是固定两跳。`,
  ]
  hops.forEach((hop, index) => {
    lines.push(`第${index + 1}跳查询：${hop.query}（S=${Number(hop.S || 0).toFixed(3)}）`)
    ;(hop.records || []).forEach((hit, hitIndex) => {
      const offset = hops.slice(0, index).reduce((sum, item) => sum + (item.records?.length || 0), 0)
      lines.push(formatHit(hit, offset + hitIndex + 1))
    })
  })
  return lines.join('\n')
}

function formatHit(hit, index) {
  const snippet = String(hit.snippet || '').replace(/\s+/g, ' ').slice(0, 360)
  return `[${index}] ${hit.title || hit.id}\nid: ${hit.id}\n${snippet}`
}

function clamp01(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function defaultSearch() {
  return []
}

/**
 * 五路不同入口 + 沿命中再跳。温度负责敢不敢改查询，入口词负责落到库的不同区域。
 * 最多 2 跳，每跳 top 3，路径分 S = S1 + γ S2。
 */

export const LANE_TEMPS = [0.35, 0.5, 0.85, 1.0, 0.95]
export const TREE_TOP_K = 3
export const TREE_HOPS = 2
export const TREE_GAMMA = 0.6
export const OVERLAP_LIMIT = 0.5

const BRIDGES = [
  { re: /粗糙|波纹|振纹|密纹|精度|超差|齿面|烧伤/, terms: ['爬行', '导轨', '润滑', '油品'] },
  { re: /抱轴|抱死|拉毛/, terms: ['油品', '间隙', '供油', '添加剂'] },
  { re: /咬毛|顶尖|中心孔/, terms: ['润滑脂', '皂液', '中心孔'] },
  { re: /发热|温升|过热|发烫/, terms: ['油品', '间隙', '供油', '润滑'] },
  { re: /乳化|起泡|变质/, terms: ['进水', '抗水性', '换油'] },
  { re: /爬行|卡滞|抖动/, terms: ['导轨', '润滑', '油品'] },
]

const MECHANISM = ['爬行', '导轨', '润滑', '油品', '润滑脂', '添加剂', '抗磨', '乳化', '进水', '间隙', '供油', '节流', '污染', '中心孔', '顶尖', '皂液', '油漆', '汽油', '抗水性']
const ANTI_THERMAL = ['油品', '润滑脂', '导轨', '添加剂', '抗磨', '供油']

export function laneTemperature(config, index) {
  const list = Array.isArray(config?.laneTemps) && config.laneTemps.length ? config.laneTemps : LANE_TEMPS
  return Number(list[index % list.length]) || LANE_TEMPS[index % LANE_TEMPS.length]
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
  const found = []
  for (const row of BRIDGES) {
    if (!row.re.test(text)) continue
    for (const term of row.terms) if (!found.includes(term)) found.push(term)
  }
  return found
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

export function pathScore(hopScores, gamma = TREE_GAMMA) {
  return hopScores.reduce((sum, value, index) => sum + Number(value || 0) * gamma ** index, 0)
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

export function runRetrievalTree({
  origin,
  firstQuery,
  hops = TREE_HOPS,
  topK = TREE_TOP_K,
  gamma = TREE_GAMMA,
  searchFn,
} = {}) {
  const t0 = String(firstQuery || origin || '').trim()
  if (!t0) return emptyTree(t0)
  const search = searchFn || defaultSearch
  const seen = new Set()
  const hop1 = takeTop(search(t0, { limit: topK, excludeIds: seen }), topK)
  for (const hit of hop1) seen.add(hit.id)
  const paths = hop1.map((hit, index) => ({
    score: pathScore([rankScore(index, hit.score)], gamma),
  }))

  const hop2Query = hops >= 2 ? nextQueryFromHits(origin || t0, hop1) : ''
  let hop2 = []
  if (hop2Query && jaccard(hop2Query, t0) < 0.85) {
    hop2 = takeTop(search(hop2Query, { limit: topK, excludeIds: seen }), topK)
    hop2.forEach((hit, index) => {
      seen.add(hit.id)
      paths.push({
        score: pathScore([rankScore(0, hop1[0]?.score), rankScore(index, hit.score)], gamma),
      })
    })
  }

  const best = paths.slice().sort((a, b) => b.score - a.score)[0]
  return {
    query: t0,
    hop2Query,
    records: uniqueRecords([...hop1, ...hop2]),
    score: best?.score || 0,
    text: formatTree({ t0, hop2Query, hop1, hop2, score: best?.score || 0 }),
  }
}

export async function runSqliteTree(options) {
  const { searchRecords } = await import('./sama-sqlite/library.mjs')
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

function collides(queries, index, origin) {
  const current = queries[index]
  if (jaccard(current, origin) > OVERLAP_LIMIT && extraTokens(origin, current).length < 2) return true
  return queries.some((other, otherIndex) => otherIndex !== 0 && otherIndex !== index && jaccard(current, other) > OVERLAP_LIMIT)
}

function joinQuery(parts) {
  const seen = new Set()
  const out = []
  for (const part of parts) {
    for (const piece of String(part || '').split(/\s+/)) {
      const token = piece.trim()
      if (!token || seen.has(token)) continue
      seen.add(token)
      out.push(token)
    }
  }
  return out.join(' ')
}

function rankScore(index, raw) {
  const n = Number(raw)
  if (Number.isFinite(n) && n > 0) return n
  return [1, 0.7, 0.4][index] || 0.2
}

function takeTop(rows, topK) {
  return (rows || []).filter((row) => row?.id).slice(0, topK)
}

function uniqueRecords(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows) {
    if (!row?.id || seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

function emptyTree(query) {
  return { query, hop2Query: '', records: [], score: 0, text: '' }
}

function formatTree({ t0, hop2Query, hop1, hop2, score }) {
  if (!hop1.length && !hop2.length) return ''
  const lines = [`本路检索树（入口：${t0}；路径分 ${Number(score).toFixed(3)}）。第 2 跳只保留与第 1 跳不同的条目。`]
  lines.push(`第1跳查询：${t0}`)
  hop1.forEach((hit, index) => lines.push(formatHit(hit, index + 1)))
  if (hop2Query && hop2.length) {
    lines.push(`第2跳查询：${hop2Query}`)
    hop2.forEach((hit, index) => lines.push(formatHit(hit, hop1.length + index + 1)))
  }
  return lines.join('\n')
}

function formatHit(hit, index) {
  const snippet = String(hit.snippet || '').replace(/\s+/g, ' ').slice(0, 360)
  return `[${index}] ${hit.title || hit.id}\nid: ${hit.id}\n${snippet}`
}

function defaultSearch() {
  return []
}

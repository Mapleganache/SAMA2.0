/**
 * 树输出之后的证据选路：片段分级、FLARE 补检、方向卡约束、过程分、ALCE 封顶。
 * 不改 ΔG 公式，不把 hop 写成常数。
 */
import { lexicalVecScore, resolveScoreVec } from './embed.mjs'
import { clip } from './json.mjs'
import { bridgeTerms, nextPathScore, normalizeRecord, TREE_GAMMA, TREE_HOP_COST, TREE_HEADER } from './retrieval-tree.mjs'

export const TAU_SUPPORT = 0.42
export const TAU_NEAR = 0.18
export const FIT_ETA = 0.65
export const ACCURACY_CAP = 5
export const MECHANISM_THETA = 5
export const PRIOR_MECHANISMS = ['热变形', '热膨胀', '砂轮不平衡', '砂轮钝化', '砂轮修整', '冷却液', '冷却', '切削液']
export const GENERIC_TERMS = ['磨床', '磨削', '故障', '问题', '机床', '数控', '工件', '加工']

const SUBSYSTEMS = [
  { id: 'guide', re: /导轨|爬行|抗爬/ },
  { id: 'spindle', re: /主轴|轴承|抱轴|静压/ },
  { id: 'feed', re: /进给|丝杠|反向|间隙/ },
  { id: 'hydraulic', re: /液压|油腔|油压/ },
  { id: 'cool', re: /冷却|切削液|乳化/ },
  { id: 'wheel', re: /砂轮/ },
  { id: 'center', re: /顶尖|中心孔|咬毛/ },
  { id: 'lube', re: /润滑|油品|润滑脂|添加剂/ },
]

export function subsystemIds(text) {
  const value = String(text || '')
  return SUBSYSTEMS.filter((row) => row.re.test(value)).map((row) => row.id)
}

export function fitScore(origin, doc) {
  const blob = `${doc?.title || ''} ${doc?.snippet || ''}`
  const cosine = lexicalVecScore(origin, [], [{ title: doc?.title || '', snippet: doc?.snippet || '', score: 0 }])
  const left = new Set(subsystemIds(origin))
  const right = new Set(subsystemIds(blob))
  let shared = 0
  for (const id of left) if (right.has(id)) shared += 1
  const overlap = left.size && right.size ? shared / Math.max(left.size, right.size) : 0
  const bridges = bridgeTerms(origin)
  const bridgeHit = bridges.some((term) => blob.includes(term)) ? 1 : 0
  const aligned = Math.max(overlap, bridgeHit)
  const genericOnly = GENERIC_TERMS.some((term) => String(origin || '').includes(term) && blob.includes(term))
    && aligned === 0
    && cosine < 0.55
  const raw = FIT_ETA * cosine + (1 - FIT_ETA) * aligned
  return genericOnly ? Math.min(raw, TAU_NEAR - 0.01) : raw
}

export function gradeRecord(origin, doc) {
  let score = fitScore(origin, doc)
  if (String(doc?.id || '').startsWith('sqlite_curated:') && score >= TAU_NEAR) score = Math.max(score, TAU_SUPPORT)
  const grade = score >= TAU_SUPPORT ? 'SUPPORT' : score >= TAU_NEAR ? 'NEAR' : 'IRRELEVANT'
  return {
    id: doc?.id || '',
    title: doc?.title || '',
    snippet: String(doc?.snippet || ''),
    score: Number(doc?.score) || 0,
    fit: Number(score.toFixed(4)),
    grade,
    doc,
  }
}

export function gradeRecords(origin, records) {
  const ranked = (records || []).map((doc) => gradeRecord(origin, doc))
  const order = { SUPPORT: 0, NEAR: 1, IRRELEVANT: 2 }
  return ranked.sort((a, b) => order[a.grade] - order[b.grade] || b.fit - a.fit)
}

export function processScore(grades) {
  if ((grades || []).some((row) => row.grade === 'SUPPORT')) return 2
  if ((grades || []).some((row) => row.grade === 'NEAR')) return 1
  return 0
}

export function flareQuery(origin, path) {
  const bridges = bridgeTerms(origin)
  const terms = [...(path || []), ...bridges].map((item) => String(item || '').trim()).filter(Boolean)
  let best = terms[0] || ''
  let bestScore = -1
  for (const term of terms) {
    const score = lexicalVecScore(origin, [term], [])
    if (score > bestScore) {
      bestScore = score
      best = term
    }
  }
  const compact = String(origin || '').replace(/\s+/g, ' ').trim()
  const short = compact.length > 40 ? compact.slice(0, 40) : compact
  return [short, best].filter(Boolean).join(' ').trim()
}

export async function decorateTree(tree, { origin, config } = {}) {
  const query = String(origin || tree?.query || '')
  let records = [...(tree?.records || [])]
  let hops = [...(tree?.hops || [])]
  let hopsUsed = Number(tree?.hopsUsed) || hops.length || 0
  let score = Number(tree?.score) || 0
  let grades = gradeRecords(query, records)

  if (!grades.some((row) => row.grade === 'SUPPORT')) {
    const extra = await flareSearch(flareQuery(query, tree?.path), new Set(records.map((row) => row.id)), config)
    if (extra.length) {
      const lastS = hops.at(-1)?.S ?? score
      const nextDocs = uniqueById([...records, ...extra])
      const { S_n: nextS, gain } = nextPathScore(query, lastS, extra, resolveScoreVec(config?.treeEmbed))
      const n = Math.max(1, hopsUsed)
      const gamma = Number(config?.treeGamma) > 0 ? Number(config.treeGamma) : TREE_GAMMA
      const lambda = Number.isFinite(Number(config?.treeHopCost)) ? Math.max(0, Number(config.treeHopCost)) : TREE_HOP_COST
      const delta = gamma ** (n - 1) * (gain - lambda)
      if (delta > 0) {
        records = nextDocs.slice(0, 4)
        hops = [...hops, { query: flareQuery(query, tree?.path), records: extra, S: nextS, reason: 'flare' }]
        hopsUsed += 1
        score += delta
        grades = gradeRecords(query, records)
      }
    }
  }

  const text = formatGradedTree({
    ...tree,
    records,
    hops,
    score,
    grades,
  })
  return {
    ...tree,
    records,
    hops,
    hopsUsed,
    score,
    grades,
    processScore: processScore(grades),
    text,
  }
}

export function formatGradedTree(tree) {
  const grades = tree.grades || gradeRecords(tree.query || '', tree.records || [])
  const usable = grades.filter((row) => row.grade !== 'IRRELEVANT')
  const dropped = grades.filter((row) => row.grade === 'IRRELEVANT')
  const tauText = tree.tauLane == null ? '' : `；路温 ${Number(tree.tauLane).toFixed(2)}`
  const lines = [
    TREE_HEADER,
    `本路检索树（入口：${tree.entryQuery || tree.query || ''}；模式 ${tree.entryMode || 'softmax'}；路径 ${(tree.path || []).join(' ')}；G ${Number(tree.score || 0).toFixed(3)}${tauText}）。跳数由 ΔG 停机，不是固定两跳。`,
    '【本路可用证据】',
  ]
  if (!usable.length) {
    lines.push('（没有 SUPPORT / NEAR 片段。只许给一个待验证主方向，禁止展开成通用磨床清单。）')
  }
  for (const row of usable) {
    lines.push(`[${row.grade}] ${row.title || row.id}\nid: ${row.id}\n${clip(row.snippet, 360)}`)
  }
  if (dropped.length) {
    lines.push('【未采用】')
    for (const row of dropped) lines.push(`[IRRELEVANT] ${row.id} ${clip(row.title || '', 80)}`)
  }
  return lines.join('\n')
}

export function fallbackDirection(grades) {
  const usable = (grades || []).filter((row) => row.grade === 'SUPPORT' || row.grade === 'NEAR')
  const top = usable[0]
  if (!top) {
    return {
      main_direction: '资料不足，只能写待测主方向',
      support_obs: [],
      from_observation: '没有 SUPPORT / NEAR 片段',
      next_check: '按现象补测后再定方向',
      alternatives: [],
      processScore: 0,
    }
  }
  return {
    main_direction: clip(top.title || top.snippet, 80),
    support_obs: [top.id].filter(Boolean),
    from_observation: clip(top.snippet, 120),
    next_check: '按该近邻机理做现场验证',
    alternatives: usable.slice(1, 3).map((row) => ({ direction: clip(row.title || row.snippet, 80), support_obs: [row.id] })),
    processScore: processScore(grades),
  }
}

export function sanitizeDirection(raw, grades) {
  const usable = (grades || []).filter((row) => row.grade === 'SUPPORT' || row.grade === 'NEAR')
  const usableIds = new Set(usable.map((row) => row.id).filter(Boolean))
  const blob = usable.map((row) => `${row.title} ${row.snippet}`).join('\n')
  const parsed = raw && typeof raw === 'object' ? raw : {}
  let main = String(parsed.main_direction || parsed.mainDirection || '').trim()
  let support = (Array.isArray(parsed.support_obs) ? parsed.support_obs : parsed.supportObs || [])
    .map((item) => String(item || '').trim())
    .filter((id) => usableIds.has(id) || usable.some((row) => id && String(row.snippet || '').includes(id)))
  if (priorWithoutEvidence(main, blob)) {
    main = ''
    support = []
  }
  const card = main && support.length
    ? {
        main_direction: main,
        support_obs: support.slice(0, 4),
        from_observation: String(parsed.from_observation || parsed.fromObservation || '').trim(),
        next_check: String(parsed.next_check || parsed.nextCheck || '').trim(),
        alternatives: (Array.isArray(parsed.alternatives) ? parsed.alternatives : [])
          .slice(0, 2)
          .map((item) => ({
            direction: String(item?.direction || '').trim(),
            support_obs: (Array.isArray(item?.support_obs) ? item.support_obs : []).map((id) => String(id || '').trim()).filter(Boolean),
          }))
          .filter((item) => item.direction && !priorWithoutEvidence(item.direction, blob)),
        processScore: processScore(grades),
      }
    : fallbackDirection(grades)
  card.processScore = processScore(grades)
  return card
}

export function priorWithoutEvidence(direction, evidenceBlob) {
  const text = String(direction || '')
  if (!text) return false
  const hit = PRIOR_MECHANISMS.find((item) => text.includes(item))
  if (!hit) return false
  return !String(evidenceBlob || '').includes(hit)
}

export function citedEvidenceIds(planText, notes) {
  const blob = `${planText || ''}\n${(notes || []).map((note) => note.observation || '').join('\n')}`
  const fromPlan = String(planText || '').match(/\b(?:sqlite_(?:curated|fragment|case)|knowledge\/[A-Za-z0-9._-]+#\d+-\d+)\b/g) || []
  const fromNotes = String(blob).match(/\b(?:sqlite_(?:curated|fragment|case):\d+)\b/g) || []
  return [...new Set([...fromPlan, ...fromNotes])]
}

export function planCitesObservation(planText, notes) {
  const plan = String(planText || '')
  if (/\b(?:sqlite_(?:curated|fragment|case):\d+|knowledge\/[A-Za-z0-9._-]+#\d+-\d+)\b/.test(plan)) return true
  const obsIds = (notes || []).map((note) => note.obsId).filter(Boolean)
  return obsIds.some((id) => plan.includes(id))
}

export function capAccuracy(score, planText, notes) {
  if (planCitesObservation(planText, notes)) return score
  return Math.min(Number(score) || 0, ACCURACY_CAP)
}

async function flareSearch(query, excludeIds, config) {
  if (!query) return []
  try {
    const { searchRecords } = await import('./sama-sqlite/library.mjs')
    const limit = Math.max(1, Number(config?.treeBeamK || config?.treeTopK) || 3)
    const result = searchRecords(query, { limit })
    return (result.records || [])
      .map(normalizeRecord)
      .filter((row) => row.id && !excludeIds?.has(row.id))
  } catch {
    return []
  }
}

function uniqueById(rows) {
  const seen = new Set()
  const out = []
  for (const row of rows || []) {
    if (!row?.id || seen.has(row.id)) continue
    seen.add(row.id)
    out.push(row)
  }
  return out
}

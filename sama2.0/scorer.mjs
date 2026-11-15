/** 证据门控打分：条件覆盖总分（CG-Rank），程序化计算，不依赖 LLM 作文分。 */
import { DIMENSIONS } from './config.mjs'
import { normalizeScores, weightedTotal } from './score.mjs'

const ENTITY_ID = /^(?:CASE|SCASE|AL|AL2|AL3|PARAM)-/i
const CITE_RE = /\b(?:sqlite_(?:curated|fragment|case):\d+|(?:CASE|SCASE|AL2?|AL3|PARAM)-[A-Za-z0-9_-]+)\b/gi

export const TAU_COVERAGE = 0.30
export const TAU_EVIDENCE = 7

const FUSE = {
  CORRECT: { e: 0.7, a: 0.3, cap: 10 },
  AMBIG: { e: 0.5, a: 0.5, cap: 8 },
  WEAK: { e: 0.2, a: 0.8, cap: 6.5 },
}

export function isEntityId(id) {
  return ENTITY_ID.test(String(id || ''))
}

export function buildEvidenceIndex(pack = []) {
  const index = new Map()
  for (const row of pack) {
    const id = String(row?.id || '').trim()
    if (!id) continue
    index.set(id, {
      id,
      grade: String(row.grade || 'IRRELEVANT'),
      fit: Number(row.fit) || 0,
      entity: isEntityId(id),
      title: row.title || '',
      hop: row.hopIndex,
    })
  }
  return index
}

export function packHasEntity(index) {
  if (!index || typeof index.values !== 'function') return false
  for (const row of index.values()) {
    if (row.entity) return true
  }
  return false
}

export function planCitations(plan) {
  const text = String(plan?.plan || '')
  const structured = Array.isArray(plan?.direction?.support_obs) ? plan.direction.support_obs : []
  const all = [...structured, ...(text.match(CITE_RE) || [])]
  return [...new Set(all.map((id) => String(id || '').trim()).filter(Boolean))]
}

/** 方案相对证据包的特征。coverage 用包覆盖为主、SUPPORT 覆盖为辅，避免 1 条 SUPPORT 直接拉满。 */
export function extractPlanEvidence(plan, index) {
  const cited = planCitations(plan)
  const valid = cited.filter((id) => index.has(id))
  const invalid = cited.filter((id) => !index.has(id))
  const grades = valid.map((id) => index.get(id).grade)
  const hasEntity = valid.some((id) => index.get(id).entity)
  const tier = hasEntity ? 3 : grades.includes('SUPPORT') ? 2 : grades.includes('NEAR') ? 1 : 0
  const supportInPack = [...index.values()].filter((row) => row.grade === 'SUPPORT').length
  const supportCited = valid.filter((id) => index.get(id).grade === 'SUPPORT').length
  const packCoverage = index.size ? Math.min(1, valid.length / index.size) : 0
  const supportRatio = supportInPack ? Math.min(1, supportCited / supportInPack) : 0
  const coverage = 0.7 * packCoverage + 0.3 * supportRatio
  return {
    cited: valid,
    invalid,
    tier,
    coverage,
    packCoverage,
    supportRatio,
    contradiction: invalid.length,
  }
}

export function evidenceScore(feature, mechanism = 0) {
  const T = (Number(feature.tier) || 0) / 3
  const C = Number(feature.coverage) || 0
  const S = Number(feature.supportRatio) || 0
  const M = Math.max(0, Math.min(10, Number(mechanism) || 0)) / 10
  const raw = 10 * (0.45 * T + 0.25 * C + 0.15 * S + 0.15 * M)
  return Math.round(raw * 10) / 10
}

export function evidenceState(feature, score) {
  const tier = Number(feature?.tier) || 0
  const contradiction = Number(feature?.contradiction) || 0
  const coverage = Number(feature?.coverage) || 0
  const E = Number(score) || 0
  if (tier >= 3) return 'CORRECT'
  if (tier === 2 && contradiction === 0 && (coverage >= TAU_COVERAGE || E >= TAU_EVIDENCE)) return 'AMBIG'
  return 'WEAK'
}

export function fusePlanScore({ plan, row, feature, llmAccuracy, precise = false }) {
  const mechanism = Number(row?.layers?.mechanism) || 0
  const E = evidenceScore(feature, mechanism)
  const state = evidenceState(feature, E)
  const fuse = FUSE[state] || FUSE.WEAK
  const base = Number.isFinite(Number(llmAccuracy)) ? Number(llmAccuracy) : 5
  let accuracy = Math.round((fuse.e * E + fuse.a * base) * 10) / 10
  accuracy = Math.min(accuracy, fuse.cap)
  if ((feature.contradiction || 0) > 0) accuracy = Math.min(accuracy, 4)
  const scores = { ...normalizeScores(row?.scores), accuracy }
  const total = weightedTotal(scores)
  const eligible = (feature.contradiction || 0) === 0 && mechanism >= 5 && scores.safety >= 2
  const override = state === 'CORRECT' || (Boolean(precise) && state === 'AMBIG')
  const strong = state === 'CORRECT' || state === 'AMBIG'
  return {
    id: plan.id,
    title: plan.title,
    scores,
    total,
    legacyTotal: Number.isFinite(Number(row?.total)) ? Number(row.total) : total,
    layers: row?.layers || {},
    evidence: {
      tier: feature.tier,
      coverage: Number(feature.coverage.toFixed(2)),
      packCoverage: Number((feature.packCoverage ?? feature.coverage).toFixed(2)),
      supportRatio: Number(feature.supportRatio.toFixed(2)),
      contradiction: feature.contradiction,
      score: E,
      state,
      override,
    },
    processScore: Number(plan?.direction?.processScore ?? row?.processScore ?? 0),
    eligible,
    recommendable: eligible && strong && scores.safety >= 3,
    weakReason: !eligible
      ? ((feature.contradiction || 0) > 0 ? 'evidence' : mechanism < 5 ? 'mechanism' : 'safety')
      : !strong ? 'evidence' : scores.safety < 3 ? 'safety' : '',
  }
}

function cmpOverride(a, b) {
  if ((b.evidence?.tier || 0) !== (a.evidence?.tier || 0)) return (b.evidence?.tier || 0) - (a.evidence?.tier || 0)
  if ((b.evidence?.score || 0) !== (a.evidence?.score || 0)) return (b.evidence?.score || 0) - (a.evidence?.score || 0)
  if (b.total !== a.total) return b.total - a.total
  if (b.scores.safety !== a.scores.safety) return b.scores.safety - a.scores.safety
  if (b.scores.accuracy !== a.scores.accuracy) return b.scores.accuracy - a.scores.accuracy
  return String(a.id).localeCompare(String(b.id), 'en')
}

function cmpShadow(a, b) {
  const ta = Number(a.legacyTotal ?? a.total)
  const tb = Number(b.legacyTotal ?? b.total)
  if (tb !== ta) return tb - ta
  if (b.scores.safety !== a.scores.safety) return b.scores.safety - a.scores.safety
  const mechA = Number(a.layers?.mechanism) || 0
  const mechB = Number(b.layers?.mechanism) || 0
  if (mechB !== mechA) return mechB - mechA
  if ((b.processScore || 0) !== (a.processScore || 0)) return (b.processScore || 0) - (a.processScore || 0)
  return String(a.id).localeCompare(String(b.id), 'en')
}

export function rankScored(rows) {
  const eligible = rows.filter((row) => row.eligible)
  const nonContra = rows.filter((row) => (row.evidence?.contradiction || 0) === 0)
  const shadow = !rows.some((row) => row.evidence?.override)
  // 影子模式完全按旧口径（全部方案、原始总分）选优；只有证据覆盖时才启用合格池。
  const pool = shadow
    ? rows
    : (eligible.length ? eligible : (nonContra.length ? nonContra : rows))
  const fallback = !shadow && eligible.length === 0 && rows.length > 0
  const sorted = pool.slice().sort(shadow ? cmpShadow : cmpOverride)
  return {
    ranked: sorted,
    fallback,
    gated: !shadow && eligible.length > 0 && eligible.length < rows.length,
    shadow,
  }
}

export function dimensionLabels() {
  return DIMENSIONS.map((dim) => dim.label)
}


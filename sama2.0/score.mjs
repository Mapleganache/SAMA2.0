import { DIMENSIONS } from './config.mjs'

export function clampScore(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(10, n))
}

export function weightedTotal(scores = {}) {
  const total = DIMENSIONS.reduce((sum, dim) => sum + clampScore(scores[dim.key]) * dim.weight, 0)
  return Math.round(total * 100) / 100
}

/**
 * 取得分最高的有效方案。平分时依次比较安全性、定位准确性。
 * 生成失败的方案不参与评选。
 */
export function pickWinner(plans, scoreRows) {
  const byId = new Map(scoreRows.map((row) => [row.id, row]))
  const ranked = plans
    .filter((plan) => plan.status === 'done' && !String(plan.plan || '').startsWith('方案生成失败'))
    .map((plan) => {
      const row = byId.get(plan.id) || { scores: {} }
      const scores = normalizeScores(row.scores)
      return {
        id: plan.id,
        title: plan.title,
        scores,
        total: weightedTotal(scores),
        defect: String(row.defect || '').trim(),
      }
    })
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      if (b.scores.safety !== a.scores.safety) return b.scores.safety - a.scores.safety
      if (b.scores.accuracy !== a.scores.accuracy) return b.scores.accuracy - a.scores.accuracy
      return String(a.id).localeCompare(String(b.id), 'en')
    })
  return ranked
}

export function normalizeScores(scores = {}) {
  const out = {}
  for (const dim of DIMENSIONS) out[dim.key] = clampScore(scores[dim.key])
  return out
}

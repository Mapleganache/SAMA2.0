import { capAccuracy } from './evidence.mjs'
import { clip, extractJson } from './json.mjs'
import { callText } from './llm.mjs'
import { logEvent } from './log.mjs'
import { clampScore } from './score.mjs'

export async function auditWinner({ query, plan, timeoutMs, temperature = 0.1 }) {
  if (!plan) return { ok: false, bestId: '', accuracy: null, credibility: null, reason: '', note: '审计未完成', ranked: [] }
  try {
    const response = await callText({
      system: accuracySystem(),
      user: accuracyUser(query, plan),
      temperature,
      timeoutMs,
      maxTokens: 800,
      purpose: 'judge',
    })
    const parsed = extractJson(response.content)
    const row = Array.isArray(parsed?.reviews) ? parsed.reviews[0] || {} : parsed || {}
    const rawAccuracy = normalizeAuditScore(row.accuracy)
    const credibility = normalizeAuditScore(row.credibility)
    if (rawAccuracy == null || credibility == null) {
      logEvent('accuracy_unusable', { accuracy: row.accuracy, credibility: row.credibility, model: response.model })
      return { ok: false, bestId: plan.id, title: plan.title, accuracy: null, credibility: null, reason: '', note: '审计不可用：未得到 0–10 整数分', ranked: [], model: response.model || '' }
    }
    const accuracy = capAccuracy(rawAccuracy, plan.plan, plan.notes)
    const review = {
      ok: true,
      bestId: plan.id,
      title: plan.title,
      accuracy,
      credibility,
      reason: String(row.reason || '').trim(),
      note: String(parsed?.note || '').trim(),
      layers: auditLayers(row, plan, accuracy, credibility),
      model: response.model || '',
      ranked: [],
    }
    review.ranked = [{ id: plan.id, title: plan.title, accuracy: review.accuracy, credibility: review.credibility, reason: review.reason }]
    logEvent('accuracy', { best: plan.id, accuracy: review.accuracy, credibility: review.credibility, model: review.model })
    return review
  } catch (error) {
    logEvent('accuracy_failed', { message: clip(error?.message || error, 300) })
    return { ok: false, bestId: plan.id, title: plan.title, accuracy: null, credibility: null, reason: '', note: '审计未完成', ranked: [], model: '' }
  }
}

export function formatAudit(review, language = 'zh') {
  if (language === 'en') {
    if (!review || review.accuracy == null) {
      return `\n\n### Audit appendix\n${review?.note || 'Audit not completed'}. The selected plan is unchanged.`
    }
    const layers = review.layers
    const layerLine = layers
      ? `\nLayers: mechanism ${layers.mechanism}/10; measures ${layers.measure}/10; uncertainty ${layers.uncertainty}/10`
      : ''
    return `\n\n### Audit appendix (top plan)\nAccuracy ${review.accuracy}/10; credibility ${review.credibility}/10.${layerLine}\n${review.reason || 'No reason provided'}${review.note ? `\n${review.note}` : ''}`
  }
  if (!review || review.accuracy == null) {
    return `\n\n### 审计附录\n${review?.note || '审计未完成'}。选定方案不变。`
  }
  const layers = review.layers
  const layerLine = layers
    ? `\n分层：机理 ${layers.mechanism}/10；具体措施 ${layers.measure}/10；不确定性表达 ${layers.uncertainty}/10`
    : ''
  return `\n\n### 审计附录（针对第一名）\n准确性 ${review.accuracy}/10，可信度 ${review.credibility}/10。${layerLine}\n${review.reason || '未写理由'}${review.note ? `\n${review.note}` : ''}`
}

function auditLayers(row, plan, accuracy, credibility) {
  const given = row?.layers || {}
  const admits = /待验证主方向|候选方向|本地无|依据不足|需现场验证/.test(plan?.plan || '')
  return {
    mechanism: clampScore(given.mechanism ?? accuracy),
    measure: clampScore(given.measure ?? credibility),
    uncertainty: clampScore(given.uncertainty ?? (admits ? 8 : 4)),
  }
}

function accuracySystem() {
  return `你是磨床维修准确性专评。你只审计已经选定的这一份方案，不重写方案，不另起维修步骤，也不给其他方案排名。
accuracy 方向契合：主方向是否由本路观察里的 SUPPORT/NEAR 推出来，有没有把观察没点到的热变形、砂轮、冷却当成已经确认的主因。没有 obsId / sqlite_ id 的主因不能给高分。
credibility 可信度：结论有多少能回溯到用户原文或方案里写明的检查依据。出现没有出处的扭矩、间隙、压力、油压、精度数值就降分。没有实测时，把结论写成待测和排查的，可信度可以高；把猜测写成定论的，可信度要低。
准确性和可信度都用 0 到 10 的整数打分（不是 0–1 比例），10 表示最好。
再给三层参考分：mechanism 机理是否由观察支撑，measure 具体措施，uncertainty 没依据时是否写成待验证主方向。
只输出 JSON：{"accuracy":0,"credibility":0,"layers":{"mechanism":0,"measure":0,"uncertainty":0},"reason":"一句理由"}`
}

function normalizeAuditScore(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  // 模型偶尔按 0–1 比例给分（实测出现 0.72）；换算成 0–10 整数。
  if (n > 0 && n < 1) {
    logEvent('accuracy_scale_normalized', { value: n })
    return Math.round(n * 10)
  }
  return Math.round(clampScore(n))
}

function accuracyUser(query, plan) {
  const notes = (plan.notes || []).map((note) => `${note.obsId || note.tool}\n${note.observation}`).join('\n\n')
  return `原始故障：\n${query}\n\n选定方案 ${plan.id}（${plan.title}）\n观察：\n${notes || '无'}\n\n成稿：\n${clip(plan.plan, 4000)}`
}

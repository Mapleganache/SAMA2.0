import { clip, extractJson } from './json.mjs'
import { callText } from './llm.mjs'
import { logEvent } from './log.mjs'
import { clampScore } from './score.mjs'

export async function judgeAccuracy({ query, plans, timeoutMs }) {
  const usable = plans.filter((plan) => plan.status === 'done' && !String(plan.plan || '').startsWith('方案生成失败'))
  if (!usable.length) {
    return { ok: false, best: null, ranked: [], note: '没有可比较准确性的有效方案' }
  }

  let rows = []
  let note = ''
  try {
    const response = await callText({
      system: accuracySystem(),
      user: accuracyUser(query, plans),
      temperature: 0.1,
      timeoutMs,
      maxTokens: 1800,
    })
    const parsed = extractJson(response.content)
    rows = Array.isArray(parsed?.reviews) ? parsed.reviews : []
    note = String(parsed?.note || '').trim()
  } catch (error) {
    note = `准确性专评调用失败，加权评判仍然有效：${error?.message || error}`
    logEvent('accuracy_failed', { message: clip(error?.message || error, 300) })
    return { ok: false, best: null, ranked: [], note }
  }

  const ranked = rankByAccuracy(plans, rows)
  const best = ranked[0] || null
  if (best) {
    logEvent('accuracy', { best: best.id, accuracy: best.accuracy, credibility: best.credibility })
  }
  return { ok: Boolean(best), best, ranked, note }
}

export function rankByAccuracy(plans, rows) {
  const byId = new Map(rows.map((row) => [String(row?.id || ''), row]))
  return plans
    .filter((plan) => plan.status === 'done' && !String(plan.plan || '').startsWith('方案生成失败'))
    .map((plan) => {
      const row = byId.get(plan.id) || {}
      return {
        id: plan.id,
        title: plan.title,
        accuracy: clampScore(row.accuracy),
        credibility: clampScore(row.credibility),
        reason: String(row.reason || '').trim(),
      }
    })
    .sort((a, b) => {
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy
      return b.credibility - a.credibility
    })
}

export function formatAccuracy(review, judgement) {
  if (!review?.best) {
    return `\n\n### 准确性专评\n${review?.note || '没有可比较准确性的有效方案。'}`
  }
  const best = review.best
  const weighted = judgement?.winner
  const differ = weighted && weighted.id && weighted.id !== best.id
    ? `\n加权综合分最高的是${weighted.title}。准确性专评最高的是${best.title}。两项分别保留。`
    : ''
  const lines = review.ranked
    .map((row) => `- ${row.title}：准确性 ${row.accuracy}/10，可信度 ${row.credibility}/10。${row.reason || '未写理由'}`)
    .join('\n')
  return `\n\n### 准确性专评
准确性最高：${best.title}（准确性 ${best.accuracy}/10，可信度 ${best.credibility}/10）
${best.reason || '未写理由'}${differ}

${lines}${review.note ? `\n\n${review.note}` : ''}`
}

function accuracySystem() {
  return `你是磨床维修准确性专评。你只比较已经写好的方案，不重写方案，不另起维修步骤。
对每一套有效方案打两个 0 到 10 的分：
accuracy 准确性：是否对准用户描述的现象，根因是否由这些现象推出来，有没有把用户没提到的故障当成已经确认的主因。
credibility 可信度：结论有多少能回溯到用户原文，或方案里写明的检查依据。出现没有出处的扭矩、间隙、压力、油压、精度数值就降分。没有实测时，把结论写成待测和排查的，可信度可以高；把猜测写成定论的，可信度要低。
生成失败的方案不要评分。
只输出 JSON：
{"note":"一句总评","reviews":[{"id":"sub1","accuracy":0,"credibility":0,"reason":"一句理由"}]}`
}

function accuracyUser(query, plans) {
  const blocks = plans.map((plan) => {
    const tools = (plan.trace || []).map((step) => step.tool || (step.final ? '给出方案' : '收束')).join(' → ')
    return `方案 ${plan.id}（${plan.title}，状态 ${plan.status}，工具顺序：${tools || '无'}）\n${clip(plan.plan, 4000)}`
  }).join('\n\n----\n\n')
  return `原始故障：\n${query}\n\n五套方案：\n${blocks}`
}

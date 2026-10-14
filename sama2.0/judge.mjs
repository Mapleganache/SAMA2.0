import { DIMENSIONS } from './config.mjs'
import { clip, extractJson } from './json.mjs'
import { callText } from './llm.mjs'
import { logEvent } from './log.mjs'
import { normalizeScores, pickWinner } from './score.mjs'

export async function judgePlans({ query, rubric, plans, timeoutMs }) {
  const usable = plans.filter((plan) => plan.status === 'done' && !String(plan.plan || '').startsWith('方案生成失败'))
  if (!usable.length) {
    return { ok: false, winner: null, ranked: [], note: '没有可评判的有效方案' }
  }

  let rows = []
  let note = ''
  try {
    const response = await callText({
      system: judgeSystem(),
      user: judgeUser(query, rubric, plans),
      temperature: 0.1,
      timeoutMs,
      maxTokens: 2500,
    })
    const parsed = extractJson(response.content)
    rows = Array.isArray(parsed?.scores) ? parsed.scores : []
    note = String(parsed?.note || '').trim()
  } catch (error) {
    note = `评判模型调用失败，已按方案是否完整做保底选择：${error?.message || error}`
    logEvent('judge_failed', { message: clip(error?.message || error, 300) })
  }

  const ranked = pickWinner(plans, rows.map(normalizeRow))
  if (!ranked.length) {
    return { ok: false, winner: null, ranked: [], note: note || '评分结果无法对应到有效方案' }
  }
  const winner = ranked[0]
  logEvent('judge', {
    winner: winner.id,
    total: winner.total,
    scores: ranked.map((row) => ({ id: row.id, total: row.total })),
  })
  return { ok: true, winner, ranked, note }
}

function normalizeRow(row) {
  return {
    id: String(row?.id || ''),
    scores: normalizeScores(row?.scores || row),
    defect: String(row?.defect || '').trim(),
  }
}

function judgeSystem() {
  const fields = DIMENSIONS.map((dim) => `${dim.key}（${dim.label}，权重 ${Math.round(dim.weight * 100)}%）`).join('、')
  return `你是磨床维修方案评判员。你只打分，不重写方案，不另起一套维修步骤。
对每一套方案按 0 到 10 分评估：${fields}。
安全性看能量隔离、砂轮防护、是否阻止带压带电拆卸。定位准确性看是否对准用户现象且没有编造数值。
生成失败的方案每一项都给 0，defect 写失败原因。
只输出 JSON：
{"note":"一句总评","scores":[{"id":"sub1","scores":{"accuracy":0,"safety":0,"feasibility":0,"completeness":0,"brevity":0},"defect":"若不是最优，写一句主要缺陷；最优项 defect 可为空"}]}`
}

function judgeUser(query, rubric, plans) {
  const notes = (rubric?.caseNotes || []).join('\n')
  const blocks = plans.map((plan) => {
    return `方案 ${plan.id}（${plan.title}，状态 ${plan.status}）\n${clip(plan.plan, 5000)}`
  }).join('\n\n----\n\n')
  return `原始故障：\n${query}\n\n本题评判注意事项：\n${notes || '无'}\n\n五套方案：\n${blocks}`
}

export function formatJudgement(plans, judgement) {
  if (!judgement?.winner) {
    const reasons = plans.map((plan) => `- ${plan.title}：${clip(plan.plan, 240)}`).join('\n')
    return `五路方案都没有形成可执行结果。\n\n${reasons}`
  }
  const winnerPlan = plans.find((plan) => plan.id === judgement.winner.id)
  const header = DIMENSIONS.map((dim) => dim.label).join(' | ')
  const lines = judgement.ranked.map((row) => {
    const cells = DIMENSIONS.map((dim) => row.scores[dim.key]).join(' | ')
    return `| ${row.title} | ${cells} | ${row.total} |`
  })
  const defects = judgement.ranked
    .filter((row) => row.id !== judgement.winner.id)
    .map((row) => `- ${row.title}：${row.defect || '未单独指出缺陷'}`)
  const failed = plans
    .filter((plan) => String(plan.plan || '').startsWith('方案生成失败'))
    .map((plan) => `- ${plan.title}：方案生成失败`)
  return `${winnerPlan?.plan || ''}

---

### 评分汇总
加权最高：${judgement.winner.title}（${judgement.winner.total} / 10）

| 方案 | ${header} | 加权 |
| --- | ${DIMENSIONS.map(() => '---').join(' | ')} | --- |
${lines.join('\n')}

### 其他方案的主要不足
${[...defects, ...failed].join('\n') || '无'}
${judgement.note ? `\n${judgement.note}` : ''}`
}

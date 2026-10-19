import { DIMENSIONS } from './config.mjs'
import { clip, extractJson } from './json.mjs'
import { callText } from './llm.mjs'
import { logEvent } from './log.mjs'
import { clampScore, normalizeScores, pickWinner } from './score.mjs'

export async function safetyOnly({ query, plan, timeoutMs }) {
  try {
    const response = await callText({
      system: `你做磨床方案安全抽查。只给安全性打 0 到 10 分，不选冠军，不写维修步骤。
安全性看能量隔离、砂轮防护、是否阻止带电或带压拆卸。
只输出 JSON：{"safety":0}`,
      user: `故障：\n${query}\n\n方案：\n${clip(plan?.plan || '', 4000)}`,
      temperature: 0.1,
      timeoutMs,
      maxTokens: 200,
    })
    const parsed = extractJson(response.content)
    return clampScore(parsed?.safety)
  } catch (error) {
    logEvent('safety_failed', { message: clip(error?.message || error, 300) })
    return 0
  }
}

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
    const observations = (plan.notes || []).map((note) => {
      const id = note.obsId || `${plan.id}-step${note.step}`
      return `${id}\n工具：${note.tool}\n参数：${JSON.stringify(note.args || {})}\n观察：${note.observation}`
    }).join('\n\n')
    const stop = plan.stopReason ? `收束：${plan.stopReason}` : ''
    const isolation = plan.supervisor?.isolation_noted ? '成稿写有隔离、断电或砂轮防护。' : '成稿未同时写明隔离、断电和砂轮防护。'
    return `方案 ${plan.id}（${plan.title}，状态 ${plan.status}）\n${stop}\n${isolation}\n${observations}\n\n成稿：\n${plan.plan}`
  }).join('\n\n----\n\n')
  return `原始故障：\n${query}\n\n本题评判注意事项：\n${notes || '无'}\n\n幸存方案：\n${blocks}`
}

export function formatJudgement(plans, judgement, rejected = []) {
  if (!judgement?.winner) {
    const lines = rejected.map((item) => `- ${item.title}：${item.unsupported.join('、') || '没有可核对的成稿'}`)
    const failed = plans
      .filter((plan) => String(plan.plan || '').startsWith('方案生成失败'))
      .map((plan) => `- ${plan.title}：方案生成失败`)
    return `本次没有可交付方案。\n\n${[...lines, ...failed].join('\n') || '没有幸存方案。'}`
  }
  const winnerPlan = plans.find((plan) => plan.id === judgement.winner.id)
  const header = DIMENSIONS.map((dim) => dim.label).join(' | ')
  const lines = judgement.ranked.map((row) => {
    const cells = DIMENSIONS.map((dim) => row.scores[dim.key]).join(' | ')
    const mark = row.id === judgement.winner.id ? '中选' : ''
    return `| ${row.title}${mark ? '（中选）' : ''} | ${cells} | ${row.total} |`
  })
  const dropped = rejected.map((item) => `- ${item.title}（${item.id}）：${labelUnsupported(item.unsupported)}`)
  const failed = plans
    .filter((plan) => String(plan.plan || '').startsWith('方案生成失败'))
    .map((plan) => `- ${plan.title}（${plan.id}）：方案生成失败`)
  return `${winnerPlan?.plan || ''}

---

### 评分汇总
中选：${judgement.winner.title}（${judgement.winner.total} / 10）

| 方案 | ${header} | 加权 |
| --- | ${DIMENSIONS.map(() => '---').join(' | ')} | --- |
${lines.join('\n')}

### 未进入候选
${[...dropped, ...failed].join('\n') || '无'}
${judgement.note ? `\n${judgement.note}` : ''}`
}

function labelUnsupported(items) {
  if (!items?.length) return '未通过出处核对'
  return items.map((item) => `含无出处 ${item}`).join('；')
}

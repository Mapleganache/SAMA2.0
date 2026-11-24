import { DIMENSIONS } from './config.mjs'
import { capAccuracy, MECHANISM_THETA } from './evidence.mjs'
import { clip, extractJson } from './json.mjs'
import { callText } from './llm.mjs'
import { logEvent } from './log.mjs'
import { hasCaseEvidence } from './grounding.mjs'
import { clampScore, normalizeScores, pickWinner, weightedTotal } from './score.mjs'

export async function safetyOnly({ query, plan, timeoutMs, temperature = 0.1 }) {
  try {
    const response = await callText({
      system: `你做磨床方案安全抽查。只给安全性打 0 到 10 分，不选冠军，不写维修步骤。
安全性看能量隔离、砂轮防护、是否阻止带电或带压拆卸。
只输出 JSON：{"safety":0}`,
      user: `故障：\n${query}\n\n方案：\n${clip(plan?.plan || '', 4000)}`,
      temperature,
      timeoutMs,
      maxTokens: 200,
      purpose: 'judge',
    })
    const parsed = extractJson(response.content)
    logEvent('safety', { safety: clampScore(parsed?.safety), model: response.model })
    return clampScore(parsed?.safety)
  } catch (error) {
    logEvent('safety_failed', { message: clip(error?.message || error, 300) })
    return 0
  }
}

export async function judgePlans({ query, rubric, plans, timeoutMs, temperature = 0.1, language = 'zh' }) {
  const usable = plans.filter((plan) => plan.status === 'done' && !String(plan.plan || '').startsWith('方案生成失败'))
  if (!usable.length) {
    return { ok: false, winner: null, ranked: [], note: '没有可评判的有效方案', model: '' }
  }

  let rows = []
  let note = ''
  let failed = false
  let model = ''
  try {
    const response = await callText({
      system: judgeSystem(language),
      user: judgeUser(query, rubric, plans),
      temperature,
      timeoutMs,
      maxTokens: 2500,
      purpose: 'judge',
    })
    model = response.model || ''
    const parsed = extractJson(response.content)
    rows = Array.isArray(parsed?.scores) ? parsed.scores : []
    note = String(parsed?.note || '').trim()
  } catch (error) {
    failed = true
    note = `评判模型调用失败，未产生评分：${error?.message || error}`
    logEvent('judge_failed', { message: clip(error?.message || error, 300) })
  }

  // 评判不可用时不伪造 0 分排名：按完整度保底选一份，并明确标注“未评分”。
  if (failed) {
    const fallback = plans
      .filter((plan) => plan.status === 'done' && !String(plan.plan || '').startsWith('方案生成失败'))
      .sort((a, b) => (b.stepCount || 0) - (a.stepCount || 0))[0] || null
    logEvent('judge_unscored', { id: fallback?.id || '', model })
    return { ok: false, winner: fallback, ranked: [], fallback: true, note: note || '评判不可用，未产生评分', model }
  }

  const fit = rankByDirectionalFit(attachLayers(pickWinner(plans, rows.map(normalizeRow)), plans, rows))
  const ranked = fit.ranked
  if (!ranked.length) {
    return { ok: false, winner: null, ranked: [], note: note || '评分结果无法对应到有效方案', model }
  }
  const winner = ranked[0]
  if (fit.mechanismFallback) {
    note = [note, '全组机制分低于阈值，按总分保底'].filter(Boolean).join('；')
  }
  logEvent('judge', {
    winner: winner.id,
    total: winner.total,
    model,
    mechanismGated: fit.mechanismGated,
    mechanismFallback: fit.mechanismFallback,
    scores: ranked.map((row) => ({ id: row.id, total: row.total })),
  })
  return { ok: true, winner, ranked, note, mechanismGated: fit.mechanismGated, mechanismFallback: fit.mechanismFallback, model }
}

function normalizeRow(row) {
  return {
    id: String(row?.id || ''),
    scores: normalizeScores(row?.scores || row),
    defect: String(row?.defect || '').trim(),
  }
}

function judgeSystem(language = 'zh') {
  const fields = DIMENSIONS.map((dim) => `${dim.key}（${dim.label}，权重 ${Math.round(dim.weight * 100)}%）`).join('、')
  const english = language === 'en' ? '\nWrite the "note" and "defect" strings in English; keep JSON keys unchanged.' : ''
  return `你是磨床维修方案评判员。你只打分，不重写方案，不另起一套维修步骤。
对每一套方案按 0 到 10 分评估：${fields}。
安全性看能量隔离、砂轮防护、是否阻止带压带电拆卸。
accuracy 方向契合：主方向是否由本路 SUPPORT/NEAR 观察推出来。观察对不上的通识主因（热变形、砂轮、冷却）必须低分。成稿主因没有 obsId 或 sqlite_ id 不能给高分。
completeness 看主方向的验证步骤是否闭环，不因为列出一长串通用故障清单而加分。
生成失败的方案每一项都给 0，defect 写失败原因。
另给三层分，其中 mechanism 参与名次：mechanism 机理是否由观察支撑，measure 具体措施是否可执行，uncertainty 没依据时有没有写成待验证主方向而不是单一结论。
只输出 JSON：
{"note":"一句总评","scores":[{"id":"sub1","scores":{"accuracy":0,"safety":0,"feasibility":0,"completeness":0,"brevity":0},"layers":{"mechanism":0,"measure":0,"uncertainty":0},"defect":"若不是最优，写一句主要缺陷；最优项 defect 可为空"}]}${english}`
}

function judgeUser(query, rubric, plans) {
  const notes = (rubric?.caseNotes || []).join('\n')
  const checklist = String(rubric?.checklist || '').trim()
  const blocks = plans.map((plan) => {
    const observations = (plan.notes || []).map((note) => {
      const id = note.obsId || `${plan.id}-step${note.step}`
      return `${id}\n工具：${note.tool}\n参数：${JSON.stringify(note.args || {})}\n观察：${note.observation}`
    }).join('\n\n')
    const stop = plan.stopReason ? `收束：${plan.stopReason}` : ''
    const isolation = plan.supervisor?.isolation_noted ? '成稿写有隔离、断电或砂轮防护。' : '成稿未同时写明隔离、断电和砂轮防护。'
    const direction = plan.direction
      ? `方向卡：${plan.direction.main_direction || '无'}；支撑 ${((plan.direction.support_obs || []).join('、')) || '无'}；过程分 ${plan.direction.processScore ?? 0}`
      : '方向卡：无'
    return `方案 ${plan.id}（${plan.title}，状态 ${plan.status}）\n${stop}\n${isolation}\n${direction}\n${observations}\n\n成稿：\n${plan.plan}`
  }).join('\n\n----\n\n')
  const checkBlock = checklist ? `\n\n${checklist}` : ''
  return `原始故障：\n${query}\n\n本题评判注意事项：\n${notes || '无'}${checkBlock}\n\n幸存方案：\n${blocks}`
}

export function pickTopChoices(judgement, plans = []) {
  return (judgement?.ranked || []).slice(0, 2).map((row, index) => ({
    place: index + 1,
    row,
    plan: plans.find((item) => item.id === row.id) || null,
  }))
}

function placeLabel(index) {
  if (index === 0) return '第一名'
  if (index === 1) return '第二名'
  return ''
}

function formatScoreCard(row) {
  const dims = DIMENSIONS.map((dim) => `${dim.label} ${row.scores?.[dim.key] ?? '—'}/10`).join('；')
  const layers = row.layers
    ? `分层：机理 ${row.layers.mechanism}/10；具体措施 ${row.layers.measure}/10；不确定性表达 ${row.layers.uncertainty}/10`
    : ''
  const proc = row.processScore == null ? '' : `过程分 ${row.processScore}/2（0 无支撑，1 近邻，2 直接 SUPPORT）`
  return [`分项：${dims}`, `加权 ${row.total} / 10`, layers, proc].filter(Boolean).join('\n')
}

function formatChoiceBlock(choice) {
  const title = choice.place === 1 ? '第一名（推荐）' : '第二名'
  return `### ${title}：${choice.row.title}（${choice.row.total} / 10）
${formatScoreCard(choice.row)}

${choice.plan?.plan || ''}`
}

export function formatJudgement(plans, judgement, rejected = [], language = 'zh') {
  if (language === 'en') return formatJudgementEn(plans, judgement, rejected)
  if (!judgement?.winner) {
    const lines = rejected.map((item) => `- ${item.title}：${item.unsupported.join('、') || '没有可核对的成稿'}`)
    const failed = plans
      .filter((plan) => String(plan.plan || '').startsWith('方案生成失败'))
      .map((plan) => `- ${plan.title}：方案生成失败`)
    return `本次没有可交付方案。\n\n${[...lines, ...failed].join('\n') || '没有幸存方案。'}`
  }
  if (judgement?.fallback) {
    const fallbackPlan = plans.find((plan) => plan.id === judgement.winner.id)
    const dropped = rejected.map((item) => `- ${item.title}（${item.id}）：${labelUnsupported(item.unsupported)}`)
    return `${fallbackPlan?.plan || ''}

---

### 评分不可用
评判模型调用失败，本次没有产生分数，按方案完整度保底交付：${judgement.winner.title}（未评分）。
${dropped.length ? `\n未进入候选：\n${dropped.join('\n')}\n` : ''}${judgement.note ? `\n${judgement.note}` : ''}`
  }
  const tops = pickTopChoices(judgement, plans)
  const intro = tops.length >= 2
    ? '下面给出综合分第一名和第二名，请对照评分自行选择。系统推荐第一名。'
    : `综合分第一名：${judgement.winner.title}（${judgement.winner.total} / 10）`
  const header = DIMENSIONS.map((dim) => dim.label).join(' | ')
  const lines = judgement.ranked.map((row, index) => {
    const cells = DIMENSIONS.map((dim) => row.scores[dim.key]).join(' | ')
    const place = placeLabel(index)
    return `| ${place ? `${place} · ` : ''}${row.title} | ${cells} | ${row.total} |`
  })
  const dropped = rejected.map((item) => `- ${item.title}（${item.id}）：${labelUnsupported(item.unsupported)}`)
  const failed = plans
    .filter((plan) => String(plan.plan || '').startsWith('方案生成失败'))
    .map((plan) => `- ${plan.title}（${plan.id}）：方案生成失败`)
  return `${intro}

${tops.map(formatChoiceBlock).join('\n\n---\n\n')}

---

### 评分对照
| 方案 | ${header} | 加权 |
| --- | ${DIMENSIONS.map(() => '---').join(' | ')} | --- |
${lines.join('\n')}

### 未进入候选
${[...dropped, ...failed].join('\n') || '无'}
${judgement.note ? `\n${judgement.note}` : ''}`
}

function formatJudgementEn(plans, judgement, rejected = []) {
  const cleanPlan = (text) => String(text || '')
    .replace(/与主控分析不一致[：:]/g, 'Deviation from preliminary analysis:')
    .replace(/^\s*(brief_deviation|thought|direction|tool|args)\s*:.*$/gmi, '')
    .trim()
  if (!judgement?.winner) {
    const lines = rejected.map((item) => `- ${item.title}: ${(item.unsupported || []).join(', ') || 'no reviewable draft'}`)
    const failed = plans.filter((plan) => String(plan.plan || '').startsWith('方案生成失败')).map((plan) => `- ${plan.title}: generation failed`)
    return `No deliverable plan in this run.\n\n${[...lines, ...failed].join('\n') || 'No surviving plan.'}`
  }
  if (judgement.fallback) {
    const fallbackPlan = plans.find((plan) => plan.id === judgement.winner.id)
    const dropped = rejected.map((item) => `- ${item.title} (${item.id}): ${(item.unsupported || []).join(', ') || 'evidence check failed'}`)
    return `${cleanPlan(fallbackPlan?.plan)}

---

### Scoring unavailable
The judge call failed, so no scores were produced. Delivering the most complete draft: ${judgement.winner.title} (unscored).
${dropped.length ? `\nRejected:\n${dropped.join('\n')}\n` : ''}${judgement.note ? `\n${judgement.note}` : ''}`
  }
  const tops = pickTopChoices(judgement, plans)
  const intro = tops.length >= 2
    ? 'Top two plans by weighted score are shown below; choose one for your site. The system recommends the first.'
    : `Top plan: ${judgement.winner.title} (${judgement.winner.total} / 10)`
  const header = DIMENSIONS.map((dim) => dim.labelEn || dim.label).join(' | ')
  const lines = judgement.ranked.map((row, index) => {
    const cells = DIMENSIONS.map((dim) => row.scores[dim.key]).join(' | ')
    const place = index === 0 ? '1st · ' : index === 1 ? '2nd · ' : ''
    return `| ${place}${row.title} | ${cells} | ${row.total} |`
  })
  const dropped = rejected.map((item) => `- ${item.title} (${item.id}): ${(item.unsupported || []).join(', ') || 'evidence check failed'}`)
  const failed = plans.filter((plan) => String(plan.plan || '').startsWith('方案生成失败')).map((plan) => `- ${plan.title} (${plan.id}): generation failed`)
  const cards = tops.map((choice, index) => {
    const scores = DIMENSIONS.map((dim) => `${dim.labelEn || dim.label} ${choice.row.scores?.[dim.key] ?? '—'}/10`).join('; ')
    const layers = choice.row.layers
      ? `\nLayers: mechanism ${choice.row.layers.mechanism}/10; measure ${choice.row.layers.measure}/10; uncertainty ${choice.row.layers.uncertainty}/10`
      : ''
    return `### ${index === 0 ? 'Recommended' : 'Alternative'}: ${choice.row.title} (${choice.row.total} / 10)\nScores: ${scores}\nWeighted ${choice.row.total} / 10${layers}\n\n${cleanPlan(choice.plan?.plan)}`
  }).join('\n\n---\n\n')
  return `${intro}

${cards}

---

### Score comparison
| Plan | ${header} | Weighted |
| --- | ${DIMENSIONS.map(() => '---').join(' | ')} | --- |
${lines.join('\n')}

### Rejected
${[...dropped, ...failed].join('\n') || 'None'}
${judgement.note ? `\n${judgement.note}` : ''}`
}

function attachLayers(ranked, plans, rawRows) {
  const raw = new Map((rawRows || []).map((row) => [String(row?.id || ''), row]))
  return ranked.map((row) => {
    const plan = plans.find((item) => item.id === row.id)
    const notes = (plan?.notes || []).map((note) => note.observation).join('\n')
    const given = raw.get(row.id)?.layers || {}
    const admits = /待验证主方向|候选方向|本地无|依据不足|需现场验证/.test(plan?.plan || '')
    const cited = hasCaseEvidence(notes)
    const structuredHit = /类型：案例条目|类型：报警表条目|【结构化条目/.test(notes) ? 1 : 0
    const accuracy = capAccuracy(row.scores.accuracy, plan?.plan, plan?.notes)
    const scores = { ...row.scores, accuracy }
    return {
      ...row,
      scores,
      total: weightedTotal(scores),
      structuredHit,
      processScore: Number(plan?.direction?.processScore ?? 0),
      layers: {
        mechanism: clampScore(given.mechanism ?? accuracy),
        measure: clampScore(given.measure ?? row.scores.completeness),
        uncertainty: clampScore(given.uncertainty ?? (admits ? 8 : cited ? 6 : 2)),
      },
    }
  })
}

export function rankByDirectionalFit(ranked) {
  const eligible = ranked.filter((row) => (row.layers?.mechanism ?? 0) >= MECHANISM_THETA)
  const mechanismFallback = eligible.length === 0 && ranked.length > 0
  const mechanismGated = eligible.length > 0 && eligible.length < ranked.length
  const pool = eligible.length ? eligible : ranked
  // 命中结构化案例/报警表的方案在同等质量下优先（+0.6 排序加成，不改展示总分）。
  const rankOf = (row) => Number(row.total || 0) + (row.structuredHit ? 0.6 : 0)
  const sorted = pool.slice().sort((a, b) => {
    if (rankOf(b) !== rankOf(a)) return rankOf(b) - rankOf(a)
    if ((b.processScore || 0) !== (a.processScore || 0)) return (b.processScore || 0) - (a.processScore || 0)
    if (b.scores.safety !== a.scores.safety) return b.scores.safety - a.scores.safety
    if (b.scores.accuracy !== a.scores.accuracy) return b.scores.accuracy - a.scores.accuracy
    return String(a.id).localeCompare(String(b.id), 'en')
  })
  return { ranked: sorted, mechanismGated, mechanismFallback }
}

function labelUnsupported(items) {
  if (!items?.length) return '未通过出处核对'
  return items.map((item) => `含无出处 ${item}`).join('；')
}


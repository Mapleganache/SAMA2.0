import { DIMENSIONS } from './config.mjs'
import { formatBriefChecklist } from './brief.mjs'

export function buildRubric(facts, brief) {
  const caseNotes = []
  if (facts?.phenomena?.length) caseNotes.push(`方案必须覆盖这些现象：${facts.phenomena.join('、')}`)
  if (facts?.machine) caseNotes.push(`设备信息：${facts.machine}。不得套用其他磨床的参数当事实。`)
  for (const item of facts?.constraints || []) caseNotes.push(`现场约束：${item}`)
  if (brief?.ok) {
    if (brief.mustCheck?.length) caseNotes.push(`必查项：${brief.mustCheck.join('；')}`)
    if (brief.exclusions?.length) caseNotes.push(`禁止项：${brief.exclusions.join('；')}`)
    if (brief.acceptance?.length) caseNotes.push(`验收：${brief.acceptance.join('；')}`)
  }
  if (!caseNotes.length) caseNotes.push('不得编造扭矩、间隙、压力和精度数值。')
  return {
    scale: '每项 0 到 10 分，加权求和后比较。分数由评判程序计算，模型只负责逐项打分。',
    dimensions: DIMENSIONS.map((dim) => ({ ...dim })),
    caseNotes,
    checklist: formatBriefChecklist(brief),
  }
}

/**
 * 主控分析简报：只产出假设与验证清单，不产出维修结论。
 */
import { extractJson } from './json.mjs'
import { callText } from './llm.mjs'

const DEFAULT_EXCLUSION = '不得编造未实测数值'

export async function buildBrief({ query, facts, complexity, timeoutMs, evidence }) {
  try {
    const response = await callText({
      system: briefSystem(),
      user: briefUser({ query, facts, complexity, evidence }),
      temperature: 0.1,
      timeoutMs,
      maxTokens: 900,
      purpose: 'judge',
    })
    return normalizeBrief(extractJson(response.content), facts)
  } catch (error) {
    return emptyBrief(facts, String(error?.message || error))
  }
}

export function formatBriefForLane(brief) {
  if (!brief?.ok) return ''
  const phenomena = (brief.phenomena || []).join('、') || '未列出'
  const hypotheses = (brief.hypotheses || [])
    .map((item) => `- ${item.id} ${item.claim}${item.checks?.length ? `（验证：${item.checks.join('；')}）` : ''}`)
    .join('\n') || '- （无）'
  const mustCheck = (brief.mustCheck || []).map((item) => `- ${item}`).join('\n') || '- （无）'
  const exclusions = (brief.exclusions || []).map((item) => `- ${item}`).join('\n') || `- ${DEFAULT_EXCLUSION}`
  return `主控的初步分析（仅作参考，不是结论）：
现象：${phenomena}
待验证假设：
${hypotheses}
必查项：
${mustCheck}
禁止：
${exclusions}
要求：如果你不同意其中任何一条，必须在成稿里写「与主控分析不一致：<哪一条><你的证据>」。`
}

export function formatBriefChecklist(brief) {
  if (!brief?.ok) return ''
  const must = (brief.mustCheck || []).join('；') || '无'
  const phenomena = (brief.phenomena || []).join('；') || '无'
  const exclusions = (brief.exclusions || []).join('；') || DEFAULT_EXCLUSION
  return `评分检查表（主控分析，仅供参考）：
- 是否回应了这些必查项：${must}
- 是否覆盖这些现象：${phenomena}
- 是否违反这些禁止项：${exclusions}
不要求方案与假设一致；与假设不一致但证据充分的，不得扣分。`
}

function normalizeBrief(parsed, facts) {
  if (!parsed || typeof parsed !== 'object') return emptyBrief(facts, '简报不是合法 JSON')
  const hypotheses = (Array.isArray(parsed.hypotheses) ? parsed.hypotheses : [])
    .map((item, index) => ({
      id: String(item?.id || `h${index + 1}`).trim() || `h${index + 1}`,
      claim: String(item?.claim || '').trim(),
      checks: (Array.isArray(item?.checks) ? item.checks : []).map((check) => String(check || '').trim()).filter(Boolean),
    }))
    .filter((item) => item.claim)
    .slice(0, 4)
  const mustCheck = (Array.isArray(parsed.mustCheck) ? parsed.mustCheck : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 5)
  const exclusions = (Array.isArray(parsed.exclusions) ? parsed.exclusions : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  if (!exclusions.some((item) => item.includes('未实测') || item.includes('编造'))) {
    exclusions.unshift(DEFAULT_EXCLUSION)
  }
  const acceptance = (Array.isArray(parsed.acceptance) ? parsed.acceptance : [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  const phenomena = (Array.isArray(parsed.phenomena) ? parsed.phenomena : facts?.phenomena || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
  const confidence = Number(parsed.confidence)
  const ok = hypotheses.length >= 2 || mustCheck.length >= 2
  return {
    ok,
    phenomena,
    hypotheses: hypotheses.slice(0, Math.max(hypotheses.length, 0)),
    mustCheck,
    exclusions,
    acceptance,
    confidence: Number.isFinite(confidence) ? Math.max(0, Math.min(1, confidence)) : 0.5,
    source: 'llm',
    note: String(parsed.note || '').trim() || (ok ? '' : '假设或必查项不足，按失败简报处理'),
  }
}

function emptyBrief(facts, note = '') {
  return {
    ok: false,
    phenomena: [...(facts?.phenomena || [])],
    hypotheses: [],
    mustCheck: [],
    exclusions: [DEFAULT_EXCLUSION],
    acceptance: [],
    confidence: 0,
    source: 'fallback',
    note,
  }
}

function briefSystem() {
  return `你是磨床故障的主控分析员。你只写分析清单，不写维修步骤，不给结论，不编造数值。
根据用户原文和已分级的近邻资料列出现象、待验证假设、必查项、禁止项和验收口径。
假设必须能被近邻资料支撑；不要把热变形、砂轮不平衡、冷却液写成默认假设，除非资料点到它们。
假设 2 到 4 条；必查项 2 到 5 条；允许列表为空时诚实写空。
exclusions 必须包含「不得编造未实测数值」。
只输出 JSON：
{"phenomena":["发热"],"hypotheses":[{"id":"h1","claim":"一句话假设","checks":["可执行验证"]}],"mustCheck":["必查项"],"exclusions":["不得编造未实测数值"],"acceptance":["验收口径"],"confidence":0.6,"note":""}`
}

function briefUser({ query, facts, complexity, evidence }) {
  const phenomena = (facts?.phenomena || []).join('、') || '未提取'
  const machine = facts?.machine || '未识别'
  const load = facts?.load || '未识别'
  const thermal = facts?.thermal || '未识别'
  const ev = String(evidence || '').trim()
  const evBlock = ev
    ? `\n\n已分级的近邻资料（假设必须从这里来）：\n${ev.slice(0, 1800)}\n`
    : '\n\n还没有分级资料。不要凭空列出热变形、砂轮、冷却液。\n'
  return `故障原文：
${query}

已提取：现象 ${phenomena}；设备 ${machine}；工况 ${load}；热态 ${thermal}。
复杂度：${complexity?.level || 'unknown'}（${complexity?.reason || ''}）
${evBlock}
只写假设与验证清单，不要维修步骤，不要数值。`
}

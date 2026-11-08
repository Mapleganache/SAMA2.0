import { CLASSIFIER_SYSTEM, classifyByRules } from './complexity.mjs'
import { extractJson } from './json.mjs'
import { callText } from './llm.mjs'
import { logEvent } from './log.mjs'

export async function classifyComplexity(userQuery, { llmTimeoutMs }) {
  const hard = classifyByRules(userQuery)
  if (hard) {
    logEvent('complexity', hard)
    return hard
  }
  try {
    const response = await callText({
      system: CLASSIFIER_SYSTEM,
      user: `用户问题：${userQuery}`,
      temperature: 0,
      timeoutMs: Math.min(llmTimeoutMs, 40000),
      maxTokens: 200,
    })
    const parsed = extractJson(response.content)
    const level = parsed?.level === 'simple' || parsed?.level === 'complex' ? parsed.level : 'complex'
    const result = {
      level,
      reason: String(parsed?.reason || '模型未给出理由，按复杂故障处理').trim(),
      source: 'llm',
    }
    logEvent('complexity', result)
    return result
  } catch (error) {
    const result = {
      level: 'complex',
      reason: `分类模型不可用，为避免漏掉故障排查，按复杂问题处理：${error?.message || error}`,
      source: 'fallback',
    }
    logEvent('complexity', { ...result, code: error?.code || '' })
    if (error?.code === 'NO_API_KEY') throw error
    return result
  }
}

export async function answerSimple({ query, history, llmTimeoutMs, allowWeb = false, webAuto = true }) {
  let evidence = ''
  let manual = ''
  let baseline = ''
  try {
    const { createToolRunner } = await import('./tools.mjs')
    const runTool = createToolRunner({ query, allowWeb, webAuto })
    const found = await Promise.all([
      runTool('search_knowledge', { query }),
      runTool('lookup_baseline', { query }),
    ])
    manual = found[0]
    baseline = found[1]
    try {
      const { lookupStructured, alarmStatus } = await import('./sama-sqlite/library.mjs')
      const alarm = alarmStatus(query)
      const directive = alarm.status === 'missing'
        ? `【强制约束】报警号 ${alarm.code} 在本库报警表中不存在：只能说明“查不到该报警号的条目”，并给通用排查方向；禁止编造或猜测其含义、原因或参数。\n\n`
        : ''
      const structured = lookupStructured(query)
      if (structured || directive) manual = `${directive}${structured ? `${structured}\n\n` : ''}${manual}`
    } catch {}
    evidence = `知识库：\n${manual}\n\n测点模板：\n${baseline}`
  } catch (error) {
    evidence = `资料检索失败：${error?.message || error}`
    manual = evidence
  }
  const prior = formatHistory(history)
  const response = await callText({
    system: `你是磨床维修助手。这是简单问题，直接回答，不要展开成多套竞争方案。
优先使用给出的资料。资料没有的参数、页码、扭矩、间隙不要编造。
资料里没有对得上的本机案例时，不要给单一确定原因。开头写明：本地无对得上的本机案例，下面只用近邻资料选一个待验证主方向。回答用中文，尽量短。`,
    user: `${prior}用户问题：\n${query}\n\n可参考资料：\n${evidence}`,
    temperature: 0.2,
    timeoutMs: llmTimeoutMs,
    maxTokens: 1800,
  })
  return {
    text: response.content.trim(),
    evidence: `${manual || ''}\n${baseline || ''}`,
    steps: [
      { tool: 'search_knowledge', observation: clipText(manual, 800) },
      { tool: 'lookup_baseline', observation: clipText(baseline, 800) },
    ],
  }
}

function clipText(text, max) {
  const value = String(text || '')
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

function formatHistory(history) {
  const rows = Array.isArray(history) ? history.slice(-4) : []
  if (!rows.length) return ''
  const text = rows
    .map((item) => `${item.role === 'assistant' ? '助手' : '用户'}：${String(item.content || '').slice(0, 500)}`)
    .join('\n')
  return `先前对话：\n${text}\n\n`
}

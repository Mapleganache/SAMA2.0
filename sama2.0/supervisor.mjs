import { checkGrounding, evidenceText } from './grounding.mjs'
import { missingFields } from './gaps.mjs'
import { extractJson } from './json.mjs'
import { callText } from './llm.mjs'
import { createToolRunner } from './tools.mjs'

const SELF_PRAISE = /[^。\n]*(最安全|最优|建议采用本方案)[^。\n]*[。]?/g

export async function superviseMid({ query, plan, notes, timeoutMs, deadline, mtkbUrl }) {
  const evidence = evidenceText(notes)
  const ground = checkGrounding(plan, evidence)
  const gap = missingFields(query)
  const isolation = /隔离|断电|砂轮防护/.test(String(plan || ''))
  const review = {
    G: ground.G,
    missing: gap.missing,
    isolation_noted: isolation,
    numeric_agree: null,
    note: '',
    disagree: false,
    unavailable: false,
    trace: [],
  }
  try {
    const runner = createToolRunner({ query, facts: {}, allowWeb: false, mtkbUrl })
    let transcript = ''
    let toolsUsed = 0
    let content = ''
    for (let turn = 0; turn < 3; turn += 1) {
      const response = await callText({
        system: supervisorSystem(),
        user: supervisorUser({ query, plan: stripPraise(plan), specs: ground.specs, evidence, transcript }),
        temperature: 0.1,
        timeoutMs,
        deadline,
        maxTokens: 800,
      })
      content = response.content
      const parsed = extractJson(content)
      const tool = String(parsed?.tool || '')
      if (tool && toolsUsed < 2 && ['search_knowledge', 'lookup_baseline', 'lookup_grind_dialect'].includes(tool)) {
        toolsUsed += 1
        const observation = await runner(tool, parsed.args || {})
        review.trace.push({ tool, observation })
        transcript += `\n${tool}\n${observation}`
        continue
      }
      review.numeric_agree = typeof parsed?.numeric_agree === 'boolean' ? parsed.numeric_agree : null
      review.isolation_noted = typeof parsed?.isolation_noted === 'boolean' ? parsed.isolation_noted : isolation
      review.note = String(parsed?.note || '').trim()
      const allowed = new Set([...gap.missing])
      review.modelMissing = (Array.isArray(parsed?.missing) ? parsed.missing : []).filter((id) => allowed.has(id))
      break
    }
    if (review.numeric_agree == null) review.unavailable = true
  } catch {
    review.unavailable = true
    review.numeric_agree = null
  }
  if (review.numeric_agree != null && review.numeric_agree !== (ground.G === 1)) review.disagree = true
  return review
}

function stripPraise(plan) {
  return String(plan || '').replace(SELF_PRAISE, '').trim()
}

function supervisorSystem() {
  return `你是独立监督者。你只对照清单，不改写方案，不宣布冠军，不补写维修步骤。
C1 扭矩、间隙、压力必须出现在该路观察里。
C2 缺机床、现象、空载或磨削、冷机或热机时，missing 只填写这些字段 id。
C3 记录成稿在拆卸之前有没有写隔离、断电和砂轮防护。
C4 其他磨床家族的参数不能写成这一台的事实；家族约束里的数值仍要能在观察里找到。
可以只读调用 search_knowledge、lookup_baseline、lookup_grind_dialect，最多两次。不要调用 ask_user。
只输出 JSON：{"numeric_agree":true,"missing":[],"isolation_noted":false,"note":"一句"}
若还要查资料：{"tool":"search_knowledge","args":{"query":"关键词"}}`
}

function supervisorUser({ query, plan, specs, evidence, transcript }) {
  return `用户原文：\n${query}\n\n待检数值：\n${specs.join('、') || '无'}\n\n该路观察：\n${evidence || '无'}\n\n送审成稿：\n${plan || '无'}\n\n监督者自己的只读查询：\n${transcript || '无'}`
}

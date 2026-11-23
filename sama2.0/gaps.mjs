import { asksForCause, isKnowledgeQuery } from './complexity.mjs'

const FIELD_IDS = new Set(['machine', 'phenomenon', 'load', 'thermal'])

const MACHINE_PATTERNS = [
  /STUDER[^，。,\s]*/i,
  /斯图特[^，。,\s]*/,
  /高桥[^，。,\s]*/,
  /MIKROSA[^，。,\s]*/i,
  /米克罗莎[^，。,\s]*/,
  /鹰贝[^，。,\s]*/,
  /外圆磨床/,
  /内圆磨床/,
  /无心磨床/,
  /平面磨床/,
  /万能磨床/,
  /数控磨床/,
  /数控车床|车床/,
  /加工中心/,
  /数控铣床|铣床|銑床/,
  /镗床/,
  /CNC\s+grinder|cylindrical\s+grinder|surface\s+grinder|centerless\s+grinder|internal\s+grinder|universal\s+grinder|grinding\s+machine|grinder/i,
  /machining\s+center/i,
  /CNC\s+lathe|lathe/i,
  /milling\s+machine|milling/i,
  /boring\s+machine/i,
]

const PHENOMENA = [
  ['发热/温升', /发热|温升|过热|发烫/],
  ['振动', /震动|振动|抖动|振纹|密纹|波纹/],
  ['异响', /异响|噪声|噪音|啸叫/],
  ['精度或表面', /精度|超差|烧伤|波纹|粗糙|圆度|密纹|拉毛|划伤/],
  ['运动异常', /爬行|卡滞|不转|停转|抱轴|抱死|咬死|闷车/],
  ['液压润滑', /泄漏|漏油|压力|油压|断油|不上油|乳化|起泡|变质|泡沫/],
  ['换刀/刀库', /换刀|刀库|刀塔|卡刀|撞刀|刀具|不能到位|不到位|刀位|刀套/],
  ['启动/停机', /不能启动|不启动|启动不了|无法启动|不能起动|起动不了|无法起动|启动困难|突然停机|掉电/],
  ['接刀/平面度', /接刀|平面度|失准|尺寸不稳|尺寸漂移|精度不稳/],
  ['报警', /报警/],
  ['heat / temperature rise', /heat|overheat|temperature rise|thermal/i],
  ['vibration / chatter', /vibration|vibrat|chatter|oscillat/i],
  ['abnormal noise', /abnormal noise|noise|squeal/i],
  ['accuracy / surface finish', /roughness|surface finish|accuracy|out of tolerance|burn|waviness|roundness|scratch/i],
  ['motion / sticking', /stick-slip|sticking|jammed|seized|stuck|not rotating|stops? rotating/i],
  ['hydraulic / lubrication', /hydraulic|oil leak|leakage|lubricat|oil pressure/i],
  ['tool change / magazine', /tool change|tool magazine|turret|ATC|tool not in position/i],
  ['start / stop', /will not start|fail(s|ed)? to start|cannot start|shutdown|stopped unexpectedly|power loss/i],
  ['alarm', /alarm|error code/i],
]

const FIELD_ORDER = ['machine', 'phenomenon', 'load', 'thermal']

const QUESTION_COPY = {
  machine: {
    text: '请写出磨床家族或型号，例如 STUDER、高桥、MIKROSA、无心磨、平面磨、外圆磨',
    why: '不同家族的拆卸位置不同，外圆磨的头架不能套到无心磨的导轮上',
  },
  phenomenon: {
    text: '请写出至少一个现象，例如发热、振动、异响、尺寸超差、爬行、漏油，或报警号',
    why: '没有现象时无法选择测点',
  },
  load: {
    text: '这个现象出现在空载，还是正在磨削',
    why: '空载和磨削对应的受力、冷却和砂轮状态不同',
  },
  thermal: {
    text: '是刚开机的冷机，还是已经运转一段时间的热机',
    why: '冷机和热机的发热、间隙和油膜判断不同',
  },
}

const QUESTION_COPY_EN = {
  machine: {
    text: 'State the grinder family or model, for example STUDER, Takasago, MIKROSA, centerless, surface, or cylindrical grinder',
    why: 'Different families have different teardown locations; a cylindrical headstock procedure does not apply to a centerless regulating wheel',
  },
  phenomenon: {
    text: 'Describe at least one symptom, for example heat, vibration, abnormal noise, size error, stick-slip, oil leak, or an alarm code',
    why: 'Without a symptom there is no way to choose inspection points',
  },
  load: {
    text: 'Does this happen at idle, or while grinding?',
    why: 'Idle and grinding differ in load, cooling, and wheel condition',
  },
  thermal: {
    text: 'Is this right after a cold start, or after the machine has been running and is hot?',
    why: 'Cold and hot states lead to different judgments on heat, clearance, and oil film',
  },
}

export function textAfterCorrection(text) {
  const raw = String(text || '')
  const mark = '更正为'
  const at = raw.lastIndexOf(mark)
  if (at < 0) return raw
  return raw.slice(at + mark.length)
}

export function readFields(userQuery) {
  const text = String(userQuery || '').trim()
  const compact = text.replace(/\s+/g, '')
  const phenomena = []
  for (const [label, re] of PHENOMENA) {
    if (re.test(compact) || re.test(text)) phenomena.push(label)
  }
  let machine = ''
  for (const re of MACHINE_PATTERNS) {
    const hit = text.match(re)
    if (hit) {
      machine = hit[0]
      break
    }
  }
  const scoped = textAfterCorrection(text)
  const load = matchLoad(scoped)
  const thermal = matchThermal(scoped)
  return { machine, phenomena, load, thermal }
}

export function missingFields(userQuery) {
  const fields = readFields(userQuery)
  const missing = []
  if (!fields.machine) missing.push('machine')
  if (!fields.phenomena.length) missing.push('phenomenon')
  if (!fields.load.value) missing.push('load')
  if (!fields.thermal.value) missing.push('thermal')
  return { fields, missing }
}

export function questionsFor(userQuery, language = 'zh') {
  const english = language === 'en'
  const { fields, missing } = missingFields(userQuery)
  const questions = missing.map((id) => {
    const copy = (english ? QUESTION_COPY_EN : QUESTION_COPY)[id]
    let text = copy.text
    if (id === 'load' && fields.load.conflict) {
      text = english
        ? `Both idle and grinding appear. Please specify which state this symptom occurred in. The text contains "${fields.load.hits.join('" and "')}".`
        : `空载和磨削都出现了，请指定这次现象发生在哪一种。原文里同时有「${fields.load.hits.join('」「')}」。`
    }
    if (id === 'thermal' && fields.thermal.conflict) {
      text = english
        ? `Both cold and hot states appear. Please specify which state this symptom occurred in. The text contains "${fields.thermal.hits.join('" and "')}".`
        : `冷机和热机都出现了，请指定这次现象发生在哪一种。原文里同时有「${fields.thermal.hits.join('」「')}」。`
    }
    return { id, text, why: copy.why }
  })
  return { fields, missing, questions }
}

export function gateDecision(query, { mode = 'soft', askedCounts = {}, language = 'zh' } = {}) {
  const english = language === 'en'
  const { missing } = missingFields(query)
  const pack = questionsFor(query, language)
  const cause = asksForCause(query)
  if (mode !== 'hard' && !cause && isKnowledgeQuery(String(query || '').replace(/\s+/g, ''))) {
    return { action: 'answer', assumptions: [], pending: [], missing }
  }
  if (!missing.length) return { action: 'sample', assumptions: [], pending: [], missing }
  // 明确的报警号或案例号属于“查表”请求，不应因缺机型/工况被追问。
  if (/例\s*\d+|#\s*\d{3,4}\b|ALM\s*\d{2,4}/i.test(String(query || ''))) {
    const assumptions = []
    if (missing.includes('machine')) assumptions.push(english ? 'Alarm/case lookup; machine model unknown' : '按报警号/案例号查表，机型未知')
    if (missing.includes('load')) assumptions.push(english ? 'Load condition not provided; assume grinding' : '未提供工况，按「磨削中」假设')
    if (missing.includes('thermal')) assumptions.push(english ? 'Thermal state not provided; assume hot machine' : '未提供冷热态，按「热机」假设')
    if (missing.includes('phenomenon')) assumptions.push(english ? 'Symptom not fully stated; answer from alarm or case content' : '现象未写清，按报警号或案例内容作答')
    return { action: 'sample', assumptions, pending: pack.questions, missing }
  }
  const blocked = missing.filter((id) => (askedCounts[id] || 0) < 2)
  const hardMissing = missing.filter((id) => id === 'machine' || id === 'phenomenon')
  const mustAsk = !cause && (mode === 'hard' || hardMissing.length === 2)
  if (mustAsk && blocked.length) return { action: 'ask', assumptions: [], pending: pack.questions, missing }
  const assumptions = []
  if (missing.includes('load')) assumptions.push(english ? 'Load condition not provided; assume grinding' : '未提供工况，按「磨削中」假设')
  if (missing.includes('thermal')) assumptions.push(english ? 'Thermal state not provided; assume hot machine' : '未提供冷热态，按「热机」假设')
  if (missing.includes('machine')) assumptions.push(english ? 'Machine model unknown; do not transfer parameters from other models' : '机型未知，不套用其他型号的参数')
  if (missing.includes('phenomenon')) assumptions.push(english ? 'Symptom incomplete; use only what the user wrote' : '现象未写清，只按原文已有描述排查')
  return { action: 'sample', assumptions, pending: pack.questions, missing }
}

export function bumpAskedCounts(askedCounts, ids) {
  const next = { ...(askedCounts || {}) }
  for (const id of ids || []) {
    if (!FIELD_IDS.has(id)) continue
    next[id] = (next[id] || 0) + 1
  }
  return next
}

export function renderNeedInfo({ fields, questions }, language = 'zh') {
  const english = language === 'en'
  const lines = [english ? 'I cannot give troubleshooting steps yet.' : '还不能给出排查步骤。', '']
  questions.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.text}`)
    if (item.why) lines.push(english ? `   Why: ${item.why}` : `   原因：${item.why}`)
    lines.push('')
  })
  lines.push(english ? `Recognized: ${recognizedLine(fields, true)}` : `已经识别：${recognizedLine(fields, false)}`)
  return lines.join('\n').trim()
}

export function composeSessionQuery(userText, session) {
  const text = String(userText || '').trim()
  if (!session?.origin) return { query: text, origin: text, supplements: [], askedCounts: {} }
  const prev = Array.isArray(session.supplements) ? session.supplements : []
  const supplements = prev.concat([{ id: 'reply', text }])
  const query = [String(session.origin).trim(), ...supplements.map((item) => String(item.text || '').trim())]
    .filter(Boolean)
    .join('\n')
  return {
    query,
    origin: String(session.origin).trim(),
    supplements,
    askedCounts: { ...(session.askedCounts || {}) },
  }
}

export function parseAskUser(args) {
  const list = Array.isArray(args?.questions) ? args.questions : []
  if (!list.length || list.length > 2) return { ok: false, reason: '一路最多两个问题' }
  const questions = []
  for (const item of list) {
    const id = String(item?.id || '')
    const text = String(item?.text || '').trim()
    if (!/^[a-z0-9_]{1,32}$/.test(id)) return { ok: false, reason: '问题 id 无效' }
    if (!text || text.length > 80) return { ok: false, reason: '问题正文不能为空且不超过 80 字' }
    questions.push({ id, text })
  }
  return { ok: true, questions }
}

export function collectQuestions(plans) {
  const rows = []
  for (const plan of plans) {
    for (const question of plan.questions || []) {
      rows.push({ ...question, step: question.step || 0, lane: plan.index || 0 })
    }
  }
  rows.sort((a, b) => a.step - b.step || a.lane - b.lane)
  const seen = new Set()
  const unique = []
  for (const row of rows) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    unique.push({ id: row.id, text: row.text })
  }
  return { questions: unique.slice(0, 3), deferred: unique.slice(3) }
}

function recognizedLine(fields, english = false) {
  const parts = []
  if (fields.machine) parts.push(english ? `machine ${fields.machine}` : `机床 ${fields.machine}`)
  if (fields.phenomena?.length) parts.push(english ? `symptoms ${fields.phenomena.join(', ')}` : `现象 ${fields.phenomena.join('、')}`)
  if (fields.load?.value) parts.push(fields.load.value)
  if (fields.thermal?.value) parts.push(fields.thermal.value)
  return parts.length ? parts.join(english ? '; ' : '；') : (english ? 'no model, symptom, or condition recognized' : '还没有识别到型号、现象或工况')
}

function matchLoad(text) {
  const raw = String(text || '')
  const idleRes = [/空载/g, /空转/g, /不磨削/g, /未磨削/g, /没在磨/g, /idle|no load|not grinding|without grinding/gi]
  const idleMatches = []
  let rest = raw
  for (const re of idleRes) {
    for (const m of raw.matchAll(re)) idleMatches.push(m)
    rest = rest.replace(re, '')
  }
  const grindHit = rest.match(/磨削|在磨|加工中|正在磨|切削|grinding|while grinding|cutting/i)
  const idle = idleMatches.length > 0
  const hits = [...idleMatches.map((m) => m[0]), ...(grindHit ? [grindHit[0]] : [])]
  if (idle && grindHit) {
    // 只有明确说两种工况都出现才算冲突；“空载振动 0.008 mm”这类是测量位置，不是发生工况。
    const explicit = /空载[和与或、]?磨削|磨削[和与或、]?空载|(?:空载|空转)[^，。；]{0,8}(?:都|均)(?:出现|有|会)|(?:都|均)(?:出现|存在)/.test(raw)
      || /(?:idle|no load)[^,.;]{0,24}(?:grinding)|(?:both|either)[^.]{0,20}(?:idle|grinding)/i.test(raw)
    const measurement = idleMatches.some((m) => {
      const after = raw.slice(m.index + m[0].length, m.index + m[0].length + 12)
      return /(振动|噪声|噪音|电流|温度|温升|读数|实测|测得|值|mm|μm|0\.\d)/.test(after)
    })
    if (explicit || !measurement) return { value: '', conflict: true, hits }
    return { value: '磨削', conflict: false, hits }
  }
  if (idle) return { value: '空载', conflict: false, hits }
  if (grindHit) return { value: '磨削', conflict: false, hits }
  return { value: '', conflict: false, hits: [] }
}

function matchThermal(text) {
  const coldRes = [/冷机/g, /刚开机/g, /温车前/g, /一开机/g, /cold\s+start|cold\s+machine|from\s+cold/i]
  const hotRes = [/热机/g, /运转一段时间/g, /连续加工/g, /磨了一小时/g, /温升后/g, /hot\s+machine|machine\s+is\s+hot|after\s+(?:running|warming)|continuous\s+machining|\bhot\b/i]
  const raw = String(text || '')
  const coldHits = collect(raw, coldRes)
  const hotHits = collect(raw, hotRes)
  if (coldHits.length && hotHits.length) return { value: '', conflict: true, hits: [...coldHits, ...hotHits] }
  if (coldHits.length) return { value: '冷机', conflict: false, hits: coldHits }
  if (hotHits.length) return { value: '热机', conflict: false, hits: hotHits }
  return { value: '', conflict: false, hits: [] }
}

function collect(text, patterns) {
  const hits = []
  for (const re of patterns) {
    const found = text.match(re)
    if (found) hits.push(found[0])
  }
  return hits
}

export { FIELD_ORDER }

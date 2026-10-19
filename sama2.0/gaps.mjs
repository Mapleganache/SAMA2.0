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
]

const PHENOMENA = [
  ['发热/温升', /发热|温升|过热|发烫/],
  ['振动', /震动|振动|抖动|振纹/],
  ['异响', /异响|噪声|噪音|啸叫/],
  ['精度或表面', /精度|超差|烧伤|波纹|粗糙|圆度/],
  ['运动异常', /爬行|卡滞|不转|停转/],
  ['液压润滑', /泄漏|漏油|压力|断油|不上油/],
  ['报警', /报警/],
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
    if (re.test(compact)) phenomena.push(label)
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

export function questionsFor(userQuery) {
  const { fields, missing } = missingFields(userQuery)
  const questions = missing.map((id) => {
    const copy = QUESTION_COPY[id]
    let text = copy.text
    if (id === 'load' && fields.load.conflict) {
      text = `空载和磨削都出现了，请指定这次现象发生在哪一种。原文里同时有「${fields.load.hits.join('」「')}」。`
    }
    if (id === 'thermal' && fields.thermal.conflict) {
      text = `冷机和热机都出现了，请指定这次现象发生在哪一种。原文里同时有「${fields.thermal.hits.join('」「')}」。`
    }
    return { id, text, why: copy.why }
  })
  return { fields, missing, questions }
}

export function renderNeedInfo({ fields, questions }) {
  const lines = ['还不能给出排查步骤。', '']
  questions.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.text}`)
    if (item.why) lines.push(`   原因：${item.why}`)
    lines.push('')
  })
  lines.push(`已经识别：${recognizedLine(fields)}`)
  return lines.join('\n').trim()
}

export function composeSessionQuery(userText, session) {
  const text = String(userText || '').trim()
  if (!session?.origin) return { query: text, origin: text, supplements: [] }
  const prev = Array.isArray(session.supplements) ? session.supplements : []
  const supplements = prev.concat([{ id: 'reply', text }])
  const query = [String(session.origin).trim(), ...supplements.map((item) => String(item.text || '').trim())]
    .filter(Boolean)
    .join('\n')
  return { query, origin: String(session.origin).trim(), supplements }
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

function recognizedLine(fields) {
  const parts = []
  if (fields.machine) parts.push(`机床 ${fields.machine}`)
  if (fields.phenomena?.length) parts.push(`现象 ${fields.phenomena.join('、')}`)
  if (fields.load?.value) parts.push(fields.load.value)
  if (fields.thermal?.value) parts.push(fields.thermal.value)
  return parts.length ? parts.join('；') : '还没有识别到型号、现象或工况'
}

function matchLoad(text) {
  const idleRes = [/空载/g, /空转/g, /不磨削/g, /未磨削/g, /没在磨/g]
  const hits = []
  let rest = String(text || '')
  let idle = false
  for (const re of idleRes) {
    const found = rest.match(re)
    if (found) {
      idle = true
      hits.push(found[0])
      rest = rest.replace(re, '')
    }
  }
  const grindRe = /磨削|在磨|加工中|正在磨|切削/
  const grindHit = rest.match(grindRe)
  if (idle && grindHit) return { value: '', conflict: true, hits: [...hits, grindHit[0]] }
  if (idle) return { value: '空载', conflict: false, hits }
  if (grindHit) return { value: '磨削', conflict: false, hits: [grindHit[0]] }
  return { value: '', conflict: false, hits: [] }
}

function matchThermal(text) {
  const coldRes = [/冷机/g, /刚开机/g, /温车前/g, /一开机/g]
  const hotRes = [/热机/g, /运转一段时间/g, /连续加工/g, /磨了一小时/g, /温升后/g]
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

/**
 * 机理卡：部件–机理–反证–鉴别问。只做附加特征，不改 fitScore 主公式。
 * SAMA2_CARDS=0 时调用方应跳过加成 / veto / 鉴别问。
 */
export const CARD_FIT_BONUS = 0.08
export const CAUSE_HEADING = '### 原因（待验证）'
export const METHOD_HEADING = '### 方法（仅针对上一节）'
export const UNKNOWN_MARK = '无法可靠诊断'

const NEG_PREFIX = /不|没|未|无|非/

export const CARDS = [
  {
    id: 'guide-lube-crawl',
    subsystem: 'guide',
    domain: 'grind',
    structure: '导轨副 / 供油',
    mechanism: '机械油抗爬性差或供油不足导致爬行',
    mechanismTerms: ['爬行', '导轨油', '抗爬', '导轨润滑'],
    symptoms: ['粗糙', '波纹', '齿面', '爬行', '卡滞'],
    support: ['热机更明显', '低速更明显', '机械油'],
    against: [
      { id: 'cold-same', keys: ['冷机同样差', '冷机也差'] },
      { id: 'oil-changed', keys: ['已换导轨油', '换了导轨油', '已换油'] },
      { id: 'wheel-freq', keys: ['振纹频率', '随砂轮转速'] },
    ],
    discriminate: [
      { ask: '低速空程时导轨是否发涩或爬行？', ifYes: 'guide-lube-crawl', ifNo: 'spindle-oil-heat' },
      { ask: '现在用的是机械油还是导轨油？', ifYes: 'guide-lube-crawl' },
    ],
    nextCheck: ['看油品铭牌', '低速空程手感', '不要先换砂轮'],
    repair: ['按油品规范改导轨油或改善供油', '现场验证后再动刮研'],
  },
  {
    id: 'spindle-oil-heat',
    subsystem: 'spindle',
    domain: 'grind',
    structure: '主轴 / 供油',
    mechanism: '主轴供油不足、油品不对或间隙异常导致抱轴或温升',
    mechanismTerms: ['供油', '抱轴', '主轴润滑', '油品', '间隙'],
    symptoms: ['抱轴', '抱死', '发热', '温升', '过热', '发烫'],
    support: ['热机更明显', '油压偏低', '断油'],
    against: [
      { id: 'cold-heat', keys: ['冷机同样发热', '冷机也发热'] },
      { id: 'oil-still', keys: ['已换油仍抱轴', '换油后仍抱轴'] },
      { id: 'idle-ok', keys: ['空载正常仅切削发热', '空载不热'] },
    ],
    discriminate: [
      { ask: '低速空程时导轨是否发涩或爬行？', ifYes: 'guide-lube-crawl', ifNo: 'spindle-oil-heat' },
      { ask: '供油压力或油窗是否明显偏低或断流？', ifYes: 'spindle-oil-heat' },
    ],
    nextCheck: ['看油窗/供油', '冷热态对比温升', '不要先拆主轴'],
    repair: ['按规范恢复供油或换对油品', '现场验证后再动轴承'],
  },
]

const GRIND_POS = /磨床|外圆磨|内圆磨|无心磨|平面磨|万能磨|砂轮|STUDER|斯图特|MIKROSA|米克罗莎|高桥|鹰贝/
const GRIND_NEG = /车床|加工中心|铣床|銑床|镗床|刀库|换刀|刀塔/

export function isGrindDomain(text, facts) {
  const raw = `${text || ''} ${facts?.machine || ''}`
  if (GRIND_NEG.test(raw) && !GRIND_POS.test(raw)) return false
  if (GRIND_POS.test(raw)) return true
  if (facts?.machine && /磨/.test(facts.machine)) return true
  return false
}

export function cardsEnabled(config) {
  if (config && Object.prototype.hasOwnProperty.call(config, 'cardsEnabled')) return Boolean(config.cardsEnabled)
  return !/^(0|false|no)$/i.test(String(process.env.SAMA2_CARDS ?? '1'))
}

export function affirmativeHit(text, phrase) {
  const blob = String(text || '')
  const needle = String(phrase || '')
  if (!needle) return false
  let from = 0
  let saw = false
  let allNegated = true
  while (from <= blob.length) {
    const i = blob.indexOf(needle, from)
    if (i < 0) break
    saw = true
    const window = blob.slice(Math.max(0, i - 8), i)
    if (!NEG_PREFIX.test(window)) allNegated = false
    from = i + Math.max(1, needle.length)
  }
  if (!saw) return false
  if (allNegated) return false
  return true
}

export function againstDecision(text, clause) {
  const keys = clause?.keys || []
  if (!keys.length) return 'none'
  let any = false
  let negated = false
  for (const key of keys) {
    const blob = String(text || '')
    let from = 0
    while (from <= blob.length) {
      const i = blob.indexOf(key, from)
      if (i < 0) break
      any = true
      const window = blob.slice(Math.max(0, i - 8), i)
      if (NEG_PREFIX.test(window)) negated = true
      from = i + Math.max(1, key.length)
    }
  }
  if (!any) return 'none'
  if (negated) return 'soft'
  return 'veto'
}

export function scoreCard(card, text) {
  const blob = String(text || '')
  let score = 0
  for (const item of card.symptoms || []) {
    if (blob.includes(item)) score += 1
  }
  for (const item of card.support || []) {
    if (affirmativeHit(blob, item)) score += 0.5
  }
  let vetoed = false
  let soft = 0
  for (const clause of card.against || []) {
    const hit = againstDecision(blob, clause)
    if (hit === 'veto') vetoed = true
    if (hit === 'soft') soft += 1
  }
  if (soft) score = Math.max(0, score - 0.4 * soft)
  return { score, vetoed }
}

export function rankCards(query, { facts, allowVeto = true } = {}) {
  const grind = isGrindDomain(query, facts)
  return CARDS.map((card) => {
    const { score, vetoed } = scoreCard(card, query)
    const activeVeto = Boolean(allowVeto && grind && vetoed)
    return {
      ...card,
      score,
      vetoed: activeVeto,
      mode: grind ? 'active' : 'reference',
    }
  }).sort((a, b) => b.score - a.score || String(a.id).localeCompare(b.id))
}

export function cardFitBonus(origin, doc, options = {}) {
  if (!options.cardsEnabled) return 0
  if (!isGrindDomain(origin, options.facts)) return 0
  const blob = `${doc?.title || ''} ${doc?.snippet || ''}`
  const ranked = rankCards(origin, { facts: options.facts, allowVeto: true })
  const usable = ranked.filter((row) => !row.vetoed && row.score > 0)
  if (!usable.length) return 0
  const hit = usable.some((card) => {
    const terms = [...(card.mechanismTerms || []), ...(card.support || [])]
    return terms.some((term) => blob.includes(term))
  })
  return hit ? CARD_FIT_BONUS : 0
}

export function applyCardsToDirection(card, { origin, facts } = {}) {
  if (!card || typeof card !== 'object') return card
  const ranked = rankCards(origin, { facts, allowVeto: true })
  const grind = isGrindDomain(origin, facts)
  const alive = ranked.filter((row) => row.score > 0 && !row.vetoed)
  const vetoed = ranked.filter((row) => row.vetoed)
  const next = { ...card, cardIds: ranked.filter((row) => row.score > 0).map((row) => row.id), cardMode: grind ? 'active' : 'reference' }
  if (!grind) {
    next.cardMode = 'reference'
    return next
  }
  const main = String(next.main_direction || '')
  const hitsVetoed = vetoed.some((row) => (row.mechanismTerms || []).some((term) => main.includes(term)) || main.includes(row.mechanism))
  if (hitsVetoed || !main || main.includes('资料不足')) {
    if (alive[0]) {
      next.main_direction = alive[0].mechanism
      next.next_check = alive[0].discriminate?.[0]?.ask || alive[0].nextCheck?.[0] || next.next_check
    } else if (vetoed.length && !alive.length) {
      next.main_direction = '反证已出现，资料不足，只能写待测主方向'
      next.next_check = vetoed[0].discriminate?.[0]?.ask || '按现象补测后再定方向'
    }
  }
  if (alive.length) {
    const alts = alive.slice(main && !hitsVetoed ? 0 : 1, 3)
      .filter((row) => row.mechanism !== next.main_direction)
      .map((row) => ({ direction: row.mechanism, support_obs: [], note: row.vetoed ? '反证已出现' : '' }))
    if (alts.length && !(next.alternatives || []).length) next.alternatives = alts
  }
  for (const row of vetoed) {
    next.alternatives = [...(next.alternatives || []), { direction: row.mechanism, support_obs: [], note: '反证已出现' }]
      .filter((item, index, all) => all.findIndex((other) => other.direction === item.direction) === index)
      .slice(0, 3)
  }
  return next
}

export function answersAlreadyPresent(query, ask) {
  const text = String(query || '')
  if (/机械油|导轨油/.test(ask) && /机械油|导轨油/.test(text)) return true
  if (/发涩|爬行/.test(ask) && /发涩|爬行|不爬|没有爬/.test(text)) return true
  if (/油窗|供油|断流/.test(ask) && /油窗|断油|断流|油压/.test(text)) return true
  return false
}

export function discriminateQuestion(cardA, cardB, query) {
  if (!cardA || !cardB || cardA.id === cardB.id) return null
  const asks = []
  const seen = new Set()
  for (const row of [...(cardA.discriminate || []), ...(cardB.discriminate || [])]) {
    const ask = String(row?.ask || '').trim()
    if (!ask || seen.has(ask)) continue
    seen.add(ask)
    asks.push(row)
  }
  for (const row of asks) {
    if (answersAlreadyPresent(query, row.ask)) continue
    return {
      id: 'discriminate',
      text: row.ask,
      why: '用来把两个不同机理分开，不是补机型或工况',
      ifYes: row.ifYes || '',
      ifNo: row.ifNo || '',
    }
  }
  return null
}

export function shouldAskDiscriminate({ query, grades, facts, askedCounts, cardsOn = true } = {}) {
  if (!cardsOn) return null
  if ((askedCounts?.discriminate || 0) >= 1) return null
  if (!isGrindDomain(query, facts)) return null
  const blob = (grades || []).map((row) => `${row.grade || ''} ${row.id || ''} ${row.title || ''}`).join('\n')
  const structured = (grades || []).some((row) => row.grade === 'SUPPORT' && /sqlite_/.test(String(row.id || '')))
    || /类型：案例条目|类型：报警表条目|【结构化条目/.test(blob)
  if (structured) return null
  const proc = (grades || []).some((row) => row.grade === 'SUPPORT') ? 2
    : (grades || []).some((row) => row.grade === 'NEAR') ? 1
      : 0
  const ranked = rankCards(query, { facts, allowVeto: true }).filter((row) => row.score > 0 && !row.vetoed)
  if (ranked.length < 2) return null
  const gap = ranked[0].score - ranked[1].score
  if (!(proc < 2 || gap < 0.5)) return null
  return discriminateQuestion(ranked[0], ranked[1], query)
}

export function mechanismConstraint(query, facts, cardsOn = true) {
  if (!cardsOn) return ''
  const ranked = rankCards(query, { facts, allowVeto: true }).filter((row) => row.score > 0)
  if (!ranked.length) return ''
  const grind = isGrindDomain(query, facts)
  const lines = ranked.map((row) => {
    const flag = row.vetoed ? '反证已出现，不得作主方向' : (grind ? '候选' : '仅参考，不参与否决')
    return `- ${row.id}（${flag}）：${row.mechanism}`
  })
  return `【机理约束】\n${lines.join('\n')}\n禁止把标注「反证已出现」的卡当主方向。非磨床题这些卡只作参考。`
}

export function cardMustCheck(query, facts, cardsOn = true) {
  if (!cardsOn || !isGrindDomain(query, facts)) return []
  return rankCards(query, { facts, allowVeto: true })
    .filter((row) => row.score > 0 && !row.vetoed)
    .flatMap((row) => row.nextCheck || [])
    .slice(0, 3)
}

const REPAIR_LINE = /拆主轴|拆卸主轴|更换砂轮|换砂轮|定油压|把油压调|拧紧到\s*\d/

export function ensureTwoSections(text, { unknown = false } = {}) {
  let body = String(text || '').trim()
  if (!body) return body
  if (unknown) {
    const stripped = body
      .split('\n')
      .filter((line) => !REPAIR_LINE.test(line))
      .join('\n')
      .trim() || '近邻证据不足，不能给出确定原因。'
    let out = stripped
    if (!/#{2,3}\s*原因/.test(out)) out = `${CAUSE_HEADING}\n${out}`
    if (!/#{2,3}\s*方法/.test(out)) {
      out += `\n\n${METHOD_HEADING}\n近邻不够，不给出拆卸或换件步骤。转交现场补测后再定维修。`
    } else {
      out = out.replace(/(#{2,3}\s*方法[\s\S]*)$/m, `${METHOD_HEADING}\n近邻不够，不给出拆卸或换件步骤。转交现场补测后再定维修。`)
    }
    if (!/无法可靠/.test(out)) {
      out += `\n\n${UNKNOWN_MARK}。请转交现场补测后再定维修步骤。`
    }
    return out
  }
  const hasCause = /#{2,3}\s*原因/.test(body)
  const hasMethod = /#{2,3}\s*方法/.test(body)
  if (hasCause && hasMethod) return body
  if (!hasCause && !hasMethod) {
    const parts = body.split(/\n{2,}/).filter(Boolean)
    if (parts.length >= 2) {
      const mid = Math.ceil(parts.length / 2)
      return `${CAUSE_HEADING}\n${parts.slice(0, mid).join('\n\n')}\n\n${METHOD_HEADING}\n${parts.slice(mid).join('\n\n')}`
    }
    return `${CAUSE_HEADING}\n${body}\n\n${METHOD_HEADING}\n按上一节方向做现场验证，不要先换件或拆主轴。`
  }
  if (!hasCause) body = `${CAUSE_HEADING}\n${body}`
  if (!hasMethod) body += `\n\n${METHOD_HEADING}\n按上一节方向做现场验证，不要先换件或拆主轴。`
  return body
}

export function lookupKindFromStructured(text) {
  const blob = String(text || '')
  if (/类型：报警表条目/.test(blob)) return 'alarm'
  if (/类型：参数表条目/.test(blob)) return 'param'
  if (/类型：案例条目/.test(blob)) return 'case'
  return ''
}

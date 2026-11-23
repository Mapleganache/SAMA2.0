/**
 * 复杂度硬规则。返回 simple / complex；边界情况返回 null，交给 LLM。
 * 复杂信号优先于简单信号，避免把多现象故障误放行。
 */

const SYMPTOM_GROUPS = [
  { id: 'thermal', re: /发热|温升|过热|发烫|烫手/ },
  { id: 'vibration', re: /震动|振动|抖动|振纹|颤振/ },
  { id: 'noise', re: /异响|噪声|噪音|啸叫|轰鸣/ },
  { id: 'accuracy', re: /精度|超差|尺寸|圆度|粗糙|烧伤|波纹|锥度/ },
  { id: 'motion', re: /爬行|卡滞|不转|停转|失步|闷车/ },
  { id: 'fluid', re: /泄漏|漏油|压力不足|不上油|断油/ },
  { id: 'alarm', re: /报警|警报|伺服报警|主轴报警/ },
]

const FAULT_HINT = /故障|异常|不正常|怎么办|如何修|怎么修|怎么查|如何排查|排查|维修/

function symptomHits(text) {
  return SYMPTOM_GROUPS.filter((group) => group.re.test(text)).map((group) => group.id)
}

export function asksForCause(text) {
  const compact = String(text || '').replace(/\s+/g, '')
  if (/怎么理解|如何理解|什么原理|工作原理|的原理/.test(compact)) return false
  return /最可能的原因|原因是什么|什么原因|故障原因|怎么造成|怎么会|为什么会|为何会|为何出现/.test(compact)
    || /mostlikelycause|whatisthecause|whatcaused|rootcause|whydoes|whyis|reasonfor/i.test(compact)
}

export function isKnowledgeQuery(text) {
  if (asksForCause(text)) return false
  const intent = /怎么理解|如何理解|是什么|为什么|什么原理|的原理|工作原理|区别|注意事项|适用边界|怎么选|如何选择/.test(text)
    || /whatis|whatdoes|meaningof|difference|principle|howtochoose/i.test(text)
  const action = /怎么办|如何修|怎么修|怎么查|如何排查|排查|怎么处理|如何处理|怎么维修|如何维修/.test(text)
    || /howtofix|howtorepair|howtocheck|howtotroubleshoot|whatshould|howdoi/i.test(text)
  return intent && !action
}

function isConcept(text) {
  const definition = /^(请问|问一下|想问)?\s*(什么是|啥是|何谓|何为|解释一下|名词解释)/.test(text)
    || /是什么(意思)?[？?]?$/.test(text)
    || /是啥[？?]?$/.test(text)
    || isKnowledgeQuery(text)
  return definition && !/怎么办|如何修|怎么修|怎么查|如何排查|仍然|依旧|还是/.test(text)
}

function isParamLookup(text) {
  const param = /标准参数|保养周期|润滑周期|更换周期|检修周期|备件型号|参数表|用什么油|用什么润滑|周期是多少|多久保养|多久更换|参数是多少/.test(text)
  const coupled = symptomHits(text).length >= 2
  const stuck = /偶发|间歇|仍然|依旧|还是|已经排查|没有解决/.test(text)
  return param && !coupled && !stuck && !/怎么办|如何修|怎么修/.test(text)
}

function isOneShot(text) {
  if (text.length > 36) return false
  if (symptomHits(text).length || FAULT_HINT.test(text)) return false
  return /怎么|如何/.test(text) && /保养|清洁|换油|点检|日常/.test(text)
}

function isCoupled(text) {
  return symptomHits(text).length >= 2
}

function isIntermittent(text) {
  return /偶发|间歇|时有时无|时好时坏|不是每次|无规律|偶尔出现|有时出现/.test(text)
    && (symptomHits(text).length > 0 || FAULT_HINT.test(text) || /故障|报警|异响|发热|振动|震动/.test(text))
}

function alreadyTried(text) {
  return /已经排查|已经检查|已经更换|换过|换了.{0,12}还是|问题还在|没有解决|依旧|仍然存在|排查后|处理过/.test(text)
    && (symptomHits(text).length > 0 || FAULT_HINT.test(text))
}

function needsSynthesis(text) {
  const hasContext = /型号|机型|工况|历史维修|维修记录|上次修/.test(text)
  const asksCombine = /结合|综合|对照/.test(text)
  const hasFault = symptomHits(text).length > 0 || /故障|报警/.test(text)
  return hasFault && hasContext && (asksCombine || /历史维修|维修记录|工况/.test(text)) && /型号|机型/.test(text)
}

export function classifyByRules(userQuery) {
  const text = String(userQuery || '').replace(/\s+/g, '').trim()
  if (!text) return { level: 'simple', reason: '空问题无需多轮排查', source: 'hard' }

  if (isCoupled(text)) {
    return { level: 'complex', reason: '同时出现多个耦合故障现象，需要分步定位', source: 'hard' }
  }
  if (isIntermittent(text)) {
    return { level: 'complex', reason: '故障偶发或间歇出现，不能按稳定复现直接下结论', source: 'hard' }
  }
  if (alreadyTried(text)) {
    return { level: 'complex', reason: '已经做过简单排查但问题仍在，需要继续往下追', source: 'hard' }
  }
  if (needsSynthesis(text)) {
    return { level: 'complex', reason: '需要结合型号、工况或历史维修记录综合判断根源', source: 'hard' }
  }
  if (asksForCause(text)) {
    return { level: 'complex', reason: '这是在问故障原因，需要对照资料排查，不能当成名词解释', source: 'hard' }
  }
  if (isConcept(text)) {
    return { level: 'simple', reason: '这是概念或名词解释，没有故障排查需求', source: 'hard' }
  }
  if (isParamLookup(text)) {
    return { level: 'simple', reason: '这是参数、保养周期或备件查询，可以一次回答', source: 'hard' }
  }
  if (isOneShot(text)) {
    return { level: 'simple', reason: '基础保养问题，一句话可以回答，不必分步排查', source: 'hard' }
  }
  return null
}

export const CLASSIFIER_SYSTEM = `你是磨床维修问题分类器。
任务：判断用户磨床相关问题是 simple 简单问题 还是 complex 复杂故障问题。
定义：
simple：名词解释、参数查询、基础保养知识，无需多轮故障推理，不需要反复调用工具排查，可一次性直接回答。
complex：设备故障类问题，存在多个耦合现象，需要多轮排查推理，多次调用工具，逐步定位故障根源，生成维修方案。

输出格式：只输出JSON，不要多余文字
{"level":"simple" or "complex","reason":"一句话理由"}`

const SHARED_TOOLS = [
  'search_knowledge',
  'lookup_baseline',
  'lookup_grind_dialect',
  'ask_user',
  'record_measurement',
  'search_mtkb',
]

const SHARED_SYSTEM = `你是磨床维修求解者。请独立阅读完整故障描述，按你自己的理解判断和作答。
查不查资料、先看什么、方案怎么组织，都由你自己决定。
没有实测或资料原文时，不要编造扭矩、间隙、压力、油压、精度和备件规格。
引用本地笔记时写下观察里的 knowledge/文件#起-止。引用案例时写下观察里的 chunk id。`

export function buildRoles(count, { start = 0, allowWeb = false } = {}) {
  const tools = allowWeb ? [...SHARED_TOOLS, 'web_search'] : [...SHARED_TOOLS]
  return Array.from({ length: count }, (_, offset) => {
    const index = start + offset
    const lane = index + 1
    return {
      id: `sub${index}`,
      title: `第${lane}路`,
      index,
      tools,
      system: `${SHARED_SYSTEM}\n这是第${lane}路独立求解，只对自己的判断负责。`,
    }
  })
}

export const SUB_ROLES = buildRoles(5)

export function toolGuide(toolNames) {
  const catalog = {
    search_knowledge: 'search_knowledge：检索本地笔记。args: {"query":"关键词","subsystem":"主轴","domain":"机械"}。domain 为空视为机械；不是机械时本地库直接说明没有该领域。返回带 knowledge/文件#起-止。',
    lookup_baseline: 'lookup_baseline：读取测点模板。args: {"query":"故障原文"}。对不上子系统时不会默认主轴。返回带 baseline/子系统。',
    lookup_grind_dialect: 'lookup_grind_dialect：识别磨床家族。args: {"query":"含机床型号的原文"}。只识别家族，不提供数值。',
    ask_user: 'ask_user：向用户提一个还没写清的分叉。args: {"questions":[{"id":"spindle_or_head","text":"80字以内"}]}。id 只用小写字母、数字和下划线。一路最多两个问题。',
    record_measurement: 'record_measurement：记下用户原文里已经写出的读数。args: {"spec":"0.02 mm","quantity":"间隙"}。quantity 只允许扭矩、间隙、压力。原文没有的数会被拒绝。',
    search_mtkb: 'search_mtkb：查询本机案例库。args 只写 {"query":"关键词"}。品牌、型号和领域由程序填写，模型另传的 brand 或 domain 会被忽略。',
    web_search: 'web_search：网页检索。args: {"query":"关键词"}。只有返回里出现的 URL 才能当作出处。',
  }
  return toolNames.map((name) => catalog[name]).filter(Boolean).join('\n')
}

export function thinkInstruction({ system, toolNames, mustFinish }) {
  if (mustFinish) {
    return `${system}
你已达到本轮上限，禁止再调用工具。
按你自己的理解，把目前的判断整理成完整维修方案。
只输出 JSON：{"thought":"收束理由","final":"完整维修方案 Markdown"}`
  }
  return `${system}
你正在独立求解这道磨床故障。可以调用工具，也可以在你认为证据够用时直接给出方案。
可用工具：
${toolGuide(toolNames)}
只输出 JSON，不要多余文字。二选一：
{"thought":"这一步为什么要查或为什么可以收束","tool":"工具名","args":{}}
{"thought":"为什么可以收束","final":"完整维修方案 Markdown"}
不要重复调用已经用过且无新信息的同一查询。`
}

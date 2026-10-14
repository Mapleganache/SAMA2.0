const SHARED_TOOLS = ['search_mechanical', 'search_knowledge', 'lookup_baseline', 'lookup_grind_dialect']

const SHARED_SYSTEM = `你是磨床维修求解者。请独立阅读完整故障描述，按你自己的理解判断和作答。
查不查资料、先看什么、方案怎么组织，都由你自己决定。
没有实测或资料原文时，不要编造扭矩、间隙、压力、油压、精度和备件规格。`

export const SUB_ROLES = [1, 2, 3, 4, 5].map((index) => ({
  id: `sub${index}`,
  title: `第${index}路`,
  tools: SHARED_TOOLS,
  system: `${SHARED_SYSTEM}\n这是第${index}路独立求解，只对自己的判断负责。`,
}))

export function toolGuide(toolNames) {
  const catalog = {
    search_mechanical: 'search_mechanical：检索本地机械维修资料。args: {"query":"关键词","subsystem":"主轴|砂轮|头架尾架|导轮|液压润滑|冷却|进给|工作台"}',
    search_knowledge: 'search_knowledge：检索本地知识库与说明书切片。args: {"query":"关键词"}',
    lookup_baseline: 'lookup_baseline：读取磨床测点模板（工具、常见方向、测点）。args: {"query":"故障原文"}',
    lookup_grind_dialect: 'lookup_grind_dialect：识别磨床/系统体系。args: {"query":"含机床型号的原文"}',
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

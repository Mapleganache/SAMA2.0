const SHARED_TOOLS = [
  'search_knowledge',
  'lookup_alarm',
  'lookup_baseline',
  'lookup_grind_dialect',
  'ask_user',
  'record_measurement',
  'search_mtkb',
]

const SHARED_SYSTEM = `你是磨床维修求解者。先读本路观察里的【可用证据】，主方向必须从 SUPPORT 或 NEAR 片段中选出。
证据不够就写下一步要测什么，禁止回退到通用磨床故障清单。观察没点到的热变形、砂轮不平衡、冷却液，不能当成主方向。
没有实测或资料原文时，不要编造扭矩、间隙、压力、油压、精度和备件规格。
检索没有对得上的本机案例时，不要写成已经确认的唯一原因。方案开头写明：本地无对得上的本机案例，下面只用近邻资料选一个待验证主方向。
如果观察中出现「类型：案例条目」或「类型：报警表条目」，说明已经命中同类案例/报警表：优先采用该条目的现象、分析、处理，不要再写「本地无对得上的本机案例」，也不要把该条目说成“近邻资料”。
引用本地笔记时写下观察里的 knowledge/文件#起-止。引用案例时写下观察里的 chunk id。成稿主因必须带这些 id。
机型、现象、空载或磨削、冷机或热机已经齐全时，优先直接给排查方案；细节不明就写明假设继续做，不要为了轴承型号、具体转速等再向用户追问。检索结果里若有 alarm_entry（报警号表）或 case_entry（案例），优先按条目作答并引用其 id；报警表里没有的报警号要明说查不到，不要猜。`

export function buildRoles(count, { start = 0, allowWeb = false, allowAskUser = true } = {}) {
  const base = allowAskUser ? SHARED_TOOLS : SHARED_TOOLS.filter((name) => name !== 'ask_user')
  const tools = allowWeb ? [...base, 'web_search'] : [...base]
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
    search_knowledge: 'search_knowledge：检索本地笔记。args: {"query":"关键词","subsystem":"主轴","domain":"机械"}。液压、润滑、主轴、进给、冷却都按机械检索。只有电路、电气、PLC、LAD 会说明没有该领域，未知 domain 忽略。返回带 knowledge/文件#起-止。',
    lookup_alarm: 'lookup_alarm：按报警号精确查表（新代 OP-/MOT-/COR- 等）。args: {"code":"OP-001"}。查到就按表里的原因和排除方法回答；查不到就明确说查不到，不要猜报警含义。',
    lookup_baseline: 'lookup_baseline：读取测点模板。args: {"query":"故障原文"}。对不上子系统时不会默认主轴。返回带 baseline/子系统。',
    lookup_grind_dialect: 'lookup_grind_dialect：识别磨床家族。args: {"query":"含机床型号的原文"}。只识别家族，不提供数值。',
    ask_user: 'ask_user：仅当缺少机型、现象、空载或磨削、冷机或热机这类硬分叉，不追问就无法起步时才用。轴承型式、转速、润滑细节等可先假设并写在方案里。args: {"questions":[{"id":"spindle_or_head","text":"80字以内"}]}。id 只用小写字母、数字和下划线。一路最多两个问题。',
    record_measurement: 'record_measurement：记下用户原文里已经写出的读数。args: {"spec":"0.02 mm","quantity":"间隙"}。quantity 只允许扭矩、间隙、压力。原文没有的数会被拒绝。',
    search_mtkb: 'search_mtkb：查询本机案例库。args 只写 {"query":"关键词"}。品牌、型号和领域由程序填写，模型另传的 brand 或 domain 会被忽略。',
    web_search: 'web_search：网页检索。args: {"query":"关键词"}。只有返回里出现的 URL 才能当作出处。',
  }
  return toolNames.map((name) => catalog[name]).filter(Boolean).join('\n')
}

const DIRECTION_JSON = `"direction":{"main_direction":"从 SUPPORT/NEAR 选出的主方向","support_obs":["sqlite_或obsId"],"from_observation":"一句话","next_check":"下一步要测什么","alternatives":[]}`

export function thinkInstruction({ system, toolNames, mustFinish }) {
  if (mustFinish) {
    return `${system}
你已达到本轮上限，禁止再调用工具。
先写方向卡，再按方向卡整理完整维修方案。方向卡必须引用观察里的 SUPPORT/NEAR，不能把观察没点到的热变形/砂轮/冷却当主方向。
只输出 JSON：{"thought":"收束理由",${DIRECTION_JSON},"final":"完整维修方案 Markdown","brief_deviation":"可空，一句话说明与主控分析哪里不一致"}`
  }
  return `${system}
你正在独立求解这道磨床故障。先读【可用证据】。可以调用工具，也可以在证据够用时直接给出方案。
可用工具：
${toolGuide(toolNames)}
只输出 JSON，不要多余文字。二选一：
{"thought":"这一步为什么要查或为什么可以收束","tool":"工具名","args":{}}
{"thought":"为什么可以收束",${DIRECTION_JSON},"final":"完整维修方案 Markdown","brief_deviation":"可空，一句话说明与主控分析哪里不一致"}
不要重复调用已经用过且无新信息的同一查询。`
}


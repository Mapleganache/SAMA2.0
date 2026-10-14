import { lookupBaseline } from './baselines.mjs'

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

export function extractFaultFacts(userQuery) {
  const text = String(userQuery || '').trim()
  const compact = text.replace(/\s+/g, '')
  const phenomena = []
  const rules = [
    ['发热/温升', /发热|温升|过热|发烫/],
    ['振动', /震动|振动|抖动|振纹/],
    ['异响', /异响|噪声|噪音|啸叫/],
    ['精度或表面', /精度|超差|烧伤|波纹|粗糙|圆度/],
    ['运动异常', /爬行|卡滞|不转|停转/],
    ['液压润滑', /泄漏|漏油|压力|断油|不上油/],
    ['报警', /报警/],
  ]
  for (const [label, re] of rules) {
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
  const constraints = []
  if (/不停机|不能停|生产中|在线/.test(compact)) constraints.push('用户提到现场可能不能随意停机')
  if (/没有.*仪|没有量具|没有备件|无备件/.test(compact)) constraints.push('现场仪器或备件受限')
  if (/不能拆|不许拆|禁止拆/.test(compact)) constraints.push('用户限制拆卸范围')
  const subsystems = lookupBaseline(compact).map((item) => item.subsystem)
  return {
    raw: text,
    phenomena,
    machine,
    constraints,
    subsystems,
  }
}

import { lookupBaseline } from './baselines.mjs'
import { readFields } from './gaps.mjs'

export function extractFaultFacts(userQuery) {
  const text = String(userQuery || '').trim()
  const compact = text.replace(/\s+/g, '')
  const fields = readFields(text)
  const constraints = []
  if (/不停机|不能停|生产中|在线/.test(compact)) constraints.push('用户提到现场可能不能随意停机')
  if (/没有.*仪|没有量具|没有备件|无备件/.test(compact)) constraints.push('现场仪器或备件受限')
  if (/不能拆|不许拆|禁止拆/.test(compact)) constraints.push('用户限制拆卸范围')
  const subsystems = lookupBaseline(compact).map((item) => item.subsystem)
  return {
    raw: text,
    phenomena: fields.phenomena,
    machine: fields.machine,
    load: fields.load.value,
    thermal: fields.thermal.value,
    constraints,
    subsystems,
  }
}

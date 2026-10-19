import { extractSpecs, kappa } from './grounding.mjs'

const QUANTITIES = new Set(['扭矩', '间隙', '压力'])

export function acceptMeasurement(query, spec) {
  const raw = String(spec || '').trim()
  if (!raw) return false
  return kappa(query).includes(kappa(raw))
}

export function recordMeasurement(query, args = {}) {
  const quantity = String(args.quantity || '').trim()
  const spec = String(args.spec || '').trim()
  if (!QUANTITIES.has(quantity)) return '拒绝：quantity 只允许扭矩、间隙、压力。'
  if (!acceptMeasurement(query, spec)) return '拒绝：该读数不在用户原文中。'
  const known = extractSpecs(query).some((item) => kappa(item) === kappa(spec)) || kappa(query).includes(kappa(spec))
  if (!known) return '拒绝：该读数不在用户原文中。'
  return `user-measure\n${quantity} ${spec}`
}

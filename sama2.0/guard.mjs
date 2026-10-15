export function canonValue(value) {
  if (Array.isArray(value)) return value.map((item) => canonValue(item))
  if (value && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonValue(value[key])
    return out
  }
  if (typeof value === 'string') return value.normalize('NFKC').trim()
  return value
}

export function actionKey(name, args) {
  return `${name}${JSON.stringify(canonValue(args || {}))}`
}

export function isDuplicate(notes, name, args) {
  const key = actionKey(name, args)
  return (notes || []).some((note) => note.executed && note.key === key)
}

export function samePrefix(previous, current, length = 200) {
  if (!previous) return false
  return prefix(previous, length) === prefix(current, length)
}

export function prefix(text, length = 200) {
  return String(text || '').slice(0, length)
}

export function createStepBudget(limit) {
  let used = 0
  return {
    claim() {
      if (used >= limit) return false
      used += 1
      return true
    },
    used() {
      return used
    },
  }
}

export function waveDeadline(startedAt, pathTimeoutMs, lanes, staggerMs) {
  const count = Math.max(1, lanes)
  return startedAt + pathTimeoutMs + (count - 1) * staggerMs
}

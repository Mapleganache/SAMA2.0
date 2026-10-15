const SPEC_RE = /(\d+(?:\.\d+)?)\s*(MPa|kPa|bar|Pa|μm|µm|um|mm|N\s*[·.*]\s*m|Nm)/gi
const KNOWLEDGE_ID = /knowledge\/[A-Za-z0-9._-]+#\d+-\d+/g
const CHUNK_ID = /[A-Za-z][A-Za-z0-9_-]*:\d+/g
const URL_RE = /https?:\/\/[^\s)\]>"']+/g

export function kappa(text) {
  let value = String(text ?? '').normalize('NFKC')
  value = value.replace(/(\d+(?:\.\d+)?)\s+/g, '$1')
  value = value.replace(/n\s*[·.*]\s*m/gi, 'N·m')
  value = value.replace(/(\d)nm/gi, '$1N·m')
  value = value.replace(/µm/gi, 'μm')
  value = value.replace(/(\d)um/gi, '$1μm')
  return value.toLowerCase()
}

export function extractSpecs(text) {
  const found = []
  const seen = new Set()
  for (const match of String(text || '').matchAll(SPEC_RE)) {
    const raw = match[0].trim()
    const key = kappa(raw)
    if (seen.has(key)) continue
    seen.add(key)
    found.push(raw)
  }
  return found
}

export function evidenceText(notes) {
  return (notes || []).map((note) => String(note.observation || '')).join('\n')
}

export function checkGrounding(planText, evidence) {
  const plan = String(planText || '')
  const evidenceRaw = String(evidence || '')
  const foldedEvidence = kappa(evidenceRaw)
  const specs = extractSpecs(plan)
  const unsupported = []
  for (const spec of specs) {
    if (!foldedEvidence.includes(kappa(spec))) unsupported.push(spec)
  }
  const missingIds = missingCitations(plan, evidenceRaw, KNOWLEDGE_ID)
  const missingChunks = missingCitations(plan, evidenceRaw, CHUNK_ID)
  const missingUrls = [...new Set(plan.match(URL_RE) || [])].filter((url) => !evidenceRaw.includes(url))
  unsupported.push(...missingIds, ...missingChunks, ...missingUrls)
  return {
    pass: unsupported.length === 0,
    G: specs.every((spec) => foldedEvidence.includes(kappa(spec))) ? 1 : 0,
    cite: missingIds.length ? 0 : 1,
    citeM: missingChunks.length ? 0 : 1,
    citeW: missingUrls.length ? 0 : 1,
    unsupported,
    specs,
  }
}

function missingCitations(plan, evidence, pattern) {
  const ids = String(plan || '').match(pattern) || []
  return [...new Set(ids)].filter((id) => !String(evidence || '').includes(id))
}

export function isFailedPlan(plan) {
  return String(plan?.plan || '').startsWith('方案生成失败')
}

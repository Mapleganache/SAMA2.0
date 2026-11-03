/**
 * 路径分里的 s_vec。默认用词频稀疏向量余弦，不依赖外网模型。
 * 接 BGE 等服务时，把 resolveScoreVec 换成嵌入余弦即可，ΔG 停机不用改。
 */

export function tokenize(text) {
  const compact = String(text || '').toLowerCase().replace(/\s+/g, '')
  const words = compact.split(/[^\p{L}\p{N}]+/u).filter((item) => item.length >= 2)
  const grams = []
  for (let i = 0; i < compact.length - 1 && grams.length < 48; i += 1) grams.push(compact.slice(i, i + 2))
  return [...words, ...grams]
}

export function termFreq(text) {
  const map = new Map()
  for (const token of tokenize(text)) map.set(token, (map.get(token) || 0) + 1)
  return map
}

export function sparseCosine(a, b) {
  if (!a?.size || !b?.size) return 0
  let dot = 0
  let na = 0
  let nb = 0
  for (const value of a.values()) na += value * value
  for (const value of b.values()) nb += value * value
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  for (const [token, value] of small) {
    if (large.has(token)) dot += value * large.get(token)
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom ? Math.max(0, Math.min(1, dot / denom)) : 0
}

export function pathText(terms, docs) {
  return [...(terms || []), ...(docs || []).map((doc) => `${doc.title || ''} ${doc.snippet || ''}`)]
    .join(' ')
    .trim()
}

export function lexicalVecScore(origin, terms, docs) {
  const right = pathText(terms, docs) || (terms || []).join(' ')
  return sparseCosine(termFreq(origin), termFreq(right))
}

export function resolveScoreVec(mode) {
  const name = String(mode || process.env.SAMA2_EMBED || 'hash').toLowerCase()
  if (name === 'jaccard' || name === 'off' || name === 'none') return null
  return lexicalVecScore
}

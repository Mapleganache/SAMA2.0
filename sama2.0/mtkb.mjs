export async function searchMtkb({ query, facts = {}, baseUrl, timeoutMs = 5000, fetchImpl = fetch }) {
  const url = `${String(baseUrl || 'http://127.0.0.1:8765').replace(/\/$/, '')}/api/v1/search`
  const brand = facts.machine || null
  const model = /\d/.test(String(facts.machine || '')) ? facts.machine : null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: String(query || ''),
        domain: '机械',
        machine_type: '磨床',
        brand,
        model,
        page: 1,
        page_size: 4,
      }),
      signal: controller.signal,
    })
    if (!response.ok) return 'MTKB 未连接'
    const data = await response.json()
    const rows = data?.results || data?.chunks || data?.data || data?.items || []
    if (!Array.isArray(rows) || !rows.length) return 'MTKB 没有命中。不要把未查到的内容写成手册条款或具体数值。'
    return rows.slice(0, 4).map((item) => {
      const id = item.id || (item.database && item.chunk_id != null ? `${item.database}:${item.chunk_id}` : '')
      const heading = item.heading || item.title || ''
      const excerpt = String(item.excerpt || item.content || item.text || '').slice(0, 700)
      return `id: ${id}\n${heading}\n${excerpt}`
    }).join('\n\n')
  } catch {
    return 'MTKB 未连接'
  } finally {
    clearTimeout(timer)
  }
}

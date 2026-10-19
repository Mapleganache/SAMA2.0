export async function searchWeb({ query, timeoutMs = 5000, fetchImpl = fetch }) {
  const q = String(query || '').trim()
  if (!q) return '网页搜索没有返回带 URL 的结果。'
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`
    const response = await fetchImpl(url, { signal: controller.signal })
    if (!response.ok) return '网页搜索没有返回带 URL 的结果。'
    const data = await response.json()
    const rows = []
    if (data?.AbstractURL && data?.AbstractText) {
      rows.push({ url: data.AbstractURL, text: String(data.AbstractText).slice(0, 700) })
    }
    for (const topic of data?.RelatedTopics || []) {
      if (topic?.FirstURL && topic?.Text) rows.push({ url: topic.FirstURL, text: String(topic.Text).slice(0, 700) })
      for (const nested of topic?.Topics || []) {
        if (nested?.FirstURL && nested?.Text) rows.push({ url: nested.FirstURL, text: String(nested.Text).slice(0, 700) })
      }
    }
    const usable = rows.filter((row) => row.url && /^https?:\/\//.test(row.url)).slice(0, 4)
    if (!usable.length) return '网页搜索没有返回带 URL 的结果。'
    return usable.map((row) => `${row.url}\n${row.text}`).join('\n\n')
  } catch {
    return '网页搜索没有返回带 URL 的结果。'
  } finally {
    clearTimeout(timer)
  }
}

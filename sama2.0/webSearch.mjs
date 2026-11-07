/**
 * 网页检索：中文优先（360 → 百度 → 搜狗），最后 Bing 兜底。
 * 返回统一格式：每条 "URL\n标题：摘要"，便于模型把 URL 当出处。
 * 可用 SAMA2_SEARCH_URL（SearXNG）或 SAMA2_SEARCH_PROVIDER=tavily 替换。
 */
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
const MISS = '网页搜索没有返回带 URL 的结果。'

export function isWebMiss(text) {
  return !/^https?:\/\//m.test(String(text || ''))
}

const CN_STOP = ['什么', '怎么', '如何', '为什么', '可以', '需要', '应该', '这个', '那个', '一下', '请问', '是否', '怎么排查', '什么意思', '直接', '给出', '答案']

/** 把长问句压成适合搜索的短查询：去掉工况词、礼貌词和指令。 */
const WEB_TERMS = ['液压油', '润滑油', '机械油', '导轨油', '润滑脂', '乳化', '进水', '抱轴', '拉毛', '咬毛', '烧伤', '粗糙度', '爬行', '导轨', '添加剂', '油品', '间隙', '供油', '静压', '动静压', '主轴', '轴承', '发热', '振动', '异响', '泄漏', '闷车', '汽油', '油漆', '清洗', '失效', '报警', '伺服']

export function toWebQuery(text) {
  const source = String(text || '')
  const terms = WEB_TERMS.filter((term) => source.includes(term)).slice(0, 4)
  if (terms.length) return terms.join(' ')
  let value = source.replace(/请直接[\s\S]*$/g, ' ')
  value = value.replace(/(数控|磨床|平面|外圆|内圆|无心|端面|曲轴|磨削中|磨削|热机|冷机|空载|大型|小型|重型|加工|生产过程中|请问|最可能|应该|怎么|如何|是什么意思|不要向我提问)/g, ' ')
  value = value.replace(/[，,。；;！？?、：:]/g, ' ')
  value = value.replace(/\s+/g, ' ').trim()
  if (value.length > 24) value = value.slice(0, 24)
  return value || source.slice(0, 24)
}

/** 检索结果是否和问题相关：型号/数字必须命中；中文按 2-gram 覆盖率判断。 */
export function looksRelevant(query, text) {
  const q = String(query || '')
  const body = String(text || '').toLowerCase()
  if (!q.trim() || !body.trim()) return false
  const rare = [...new Set(q.match(/[A-Za-z][A-Za-z0-9._-]{1,}|[0-9]{2,}/g) || [])]
    .map((item) => item.toLowerCase())
    .filter((item) => item.length >= 2)
  if (rare.length) return rare.every((token) => body.includes(token))
  const cn = q.replace(/[^\u4e00-\u9fa5]/g, '')
  if (cn.length < 2) return true
  const grams = new Set()
  for (let i = 0; i < cn.length - 1; i += 1) {
    const gram = cn.slice(i, i + 2)
    if (!CN_STOP.includes(gram)) grams.add(gram)
  }
  if (!grams.size) return true
  let hit = 0
  for (const gram of grams) if (body.includes(gram)) hit += 1
  return hit / grams.size >= 0.34
}

/** 本地检索“没命中”的判定：
 *  - 没有任何 sqlite 证据 ID，且带缺失提示语 → 没命中；
 *  - 只有 sqlite_fragment（通用手册），没有 curated/case（案例或精编）→ 也算没命中；
 *  - 有 curated/case 但和问题不相关（型号/数字对不上）→ 同样算没命中。
 */
export function isLibraryMiss(text, query = '') {
  const value = String(text || '')
  if (!value.trim()) return true
  if (/sqlite_(?:curated|case):\d+/.test(value)) {
    return query ? !looksRelevant(query, value) : false
  }
  if (/sqlite_fragment:\d+/.test(value)) return true
  return /本地知识库没有该领域|全量库没有符合范围|没有该章节和实例的对应原文|没有对应的SQLite|没有可检索词|未找到可用条目|没有查询词/.test(value)
}

function clean(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|amp|lt|gt|quot|#39|nbsp);/gi, (match, entity) => {
      const key = entity.toLowerCase()
      if (key === 'amp') return '&'
      if (key === 'lt') return '<'
      if (key === 'gt') return '>'
      if (key === 'quot') return '"'
      if (key === 'nbsp') return ' '
      if (key === '#39') return "'"
      if (key.startsWith('#x')) return String.fromCodePoint(parseInt(key.slice(2), 16))
      if (key.startsWith('#')) return String.fromCodePoint(parseInt(key.slice(1), 10))
      return match
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function decodeBingUrl(href) {
  try {
    const url = new URL(href, 'https://www.bing.com')
    if (!/\/ck\/a/.test(url.pathname)) return url.href
    const raw = url.searchParams.get('u') || ''
    if (!raw.startsWith('a1')) return url.href
    const decoded = Buffer.from(raw.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')
    return /^https?:\/\//.test(decoded) ? decoded : url.href
  } catch {
    return href
  }
}

export function parseBingHtml(html, limit = 4) {
  const blocks = String(html || '').split('<li class="b_algo"').slice(1)
  const rows = []
  const seen = new Set()
  for (const block of blocks) {
    const chunk = block.split('</li>')[0]
    if (/b_ad|aclk/.test(chunk.slice(0, 120))) continue
    const anchor = chunk.match(/<h2[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/)
    if (!anchor) continue
    const url = decodeBingUrl(anchor[1])
    if (!/^https?:\/\//.test(url) || /bing\.com\/(aclk|ck\/a)/.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    const paragraph = chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/)
    rows.push({ url, title: clean(anchor[2]), text: clean(paragraph ? paragraph[1] : '') })
    if (rows.length >= limit) break
  }
  return rows
}

/** 通用：按结果块正则切块，再取标题链接与摘要。 */
function parseBlocks(html, splitPattern, anchorPattern, snippetPattern, limit = 4) {
  const chunks = String(html || '').split(splitPattern).slice(1)
  const rows = []
  const seen = new Set()
  for (const chunk of chunks) {
    const anchor = chunk.match(anchorPattern)
    if (!anchor) continue
    const url = anchor[1]
    if (!/^https?:\/\//.test(url) && !url.startsWith('/link') && !url.startsWith('http')) continue
    const title = clean(anchor[2])
    const snippet = chunk.match(snippetPattern)
    const text = clean(snippet ? snippet[1] : '')
    if (seen.has(url)) continue
    seen.add(url)
    rows.push({ url, title, text })
    if (rows.length >= limit) break
  }
  return rows
}

const DICT = /_百度百科|汉语字典|词典|拼音|部首|笔画|汉字|字的意思|造句|成语|英文单词|词语解释/

function notDictionary(rows) {
  return rows.filter((row) => !DICT.test(String(row.title || '')))
}

export function parse360Html(html, limit = 4) {
  return parseBlocks(
    html,
    '<li class="res-list"',
    /<h3[^>]*class="[^"]*res-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
    /<p[^>]*class="[^"]*res-desc[^"]*"[^>]*>([\s\S]*?)<\/p>/,
    limit + 4,
  ).filter((row) => !DICT.test(String(row.title || ''))).slice(0, limit)
}

export function parseBaiduHtml(html, limit = 4) {
  return parseBlocks(
    html,
    /<div[^>]*class="result[^"]*c-container[^"]*"/,
    /<h3[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
    /<div[^>]*class="[^"]*(?:c-abstract|content-right)[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    limit,
  )
}

export function parseSogouHtml(html, limit = 4) {
  return parseBlocks(
    html,
    /<div[^>]*class="(?:vrwrap|rb)[^"]*"/,
    /<h3[^>]*class="[^"]*vr-title[^"]*"[^>]*>[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/,
    /<div[^>]*class="[^"]*(?:text-layout|star-wiki)[^"]*"[^>]*>([\s\S]*?)<\/div>/,
    limit,
  )
}

const RESOLVE_LIMIT = 4
async function resolveUrl(url, fetchImpl, timeoutMs) {
  if (!/^https?:\/\//.test(url)) return url
  if (!/baidu\.com\/link|sogou\.com\/link|so\.com\/link/.test(url)) return url
  try {
    const response = await fetchImpl(url, {
      headers: { 'user-agent': UA },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    })
    const finalUrl = response.url || url
    if (!/baidu\.com\/link|sogou\.com\/link|so\.com\/link/.test(finalUrl)) return finalUrl
    // 有些跳转页用 meta refresh / location.replace 落地
    const html = await response.text()
    const meta = html.match(/http-equiv=["']?refresh["']?[^>]*url=([^"'>\s]+)/i)
    if (meta && /^https?:\/\//.test(meta[1])) return meta[1]
    const js = html.match(/location\.(?:replace|href)\s*=\s*["']([^"']+)["']/i)
    if (js && /^https?:\/\//.test(js[1])) return js[1]
    return url
  } catch {
    return url
  }
}

async function engineRows(name, query, { fetchImpl, timeoutMs, limit }) {
  const q = encodeURIComponent(query)
  if (name === '360') {
    const res = await fetchImpl(`https://www.so.com/s?q=${q}`, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(timeoutMs) })
    if (!res.ok) return []
    // ai.so.com 是 360 的 AI 摘要页，不是可引用的原始来源
    return parse360Html(await res.text(), limit + 2).filter((row) => !/ai\.so\.com/.test(row.url)).slice(0, limit)
  }
  if (name === 'baidu') {
    const res = await fetchImpl(`https://www.baidu.com/s?wd=${q}`, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(timeoutMs) })
    return res.ok ? parseBaiduHtml(await res.text(), limit) : []
  }
  if (name === 'sogou') {
    const res = await fetchImpl(`https://www.sogou.com/web?query=${q}`, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(timeoutMs) })
    return res.ok ? parseSogouHtml(await res.text(), limit) : []
  }
  const res = await fetchImpl(`https://www.bing.com/search?q=${q}&mkt=zh-CN&setlang=zh-Hans`, { headers: { 'user-agent': UA, 'accept-language': 'zh-CN,zh;q=0.9' }, signal: AbortSignal.timeout(timeoutMs) })
  return res.ok ? parseBingHtml(await res.text(), limit) : []
}

async function searxngRows(query, { fetchImpl, timeoutMs, limit }) {
  const base = process.env.SAMA2_SEARCH_URL
  const url = `${base}${base.includes('?') ? '&' : '?'}q=${encodeURIComponent(query)}&format=json`
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) return []
  const data = await response.json()
  return (data?.results || []).slice(0, limit).map((row) => ({ url: row.url, title: row.title || '', text: clean(row.content || '') }))
}

async function tavilyRows(query, { fetchImpl, timeoutMs, limit }) {
  const key = process.env.SAMA2_SEARCH_API_KEY || process.env.TAVILY_API_KEY
  if (!key) return []
  const response = await fetchImpl('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, max_results: limit, search_depth: 'basic' }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!response.ok) return []
  const data = await response.json()
  return (data?.results || []).slice(0, limit).map((row) => ({ url: row.url, title: row.title || '', text: clean(row.content || '') }))
}

export async function searchWeb({ query, timeoutMs = 8000, fetchImpl = fetch, limit = 4 } = {}) {
  const q = String(query || '').trim()
  if (!q) return MISS
  const provider = String(process.env.SAMA2_SEARCH_PROVIDER || '').toLowerCase()
  let rows = []
  try {
    if (process.env.SAMA2_SEARCH_URL) rows = await searxngRows(q, { fetchImpl, timeoutMs, limit })
    else if (provider === 'tavily') rows = await tavilyRows(q, { fetchImpl, timeoutMs, limit })
    for (const engine of ['360', 'baidu', 'sogou', 'bing']) {
      if (rows.length) break
      rows = await engineRows(engine, q, { fetchImpl, timeoutMs, limit })
    }
  } catch {
    rows = []
  }
  const usable = rows.filter((row) => row.url && /^https?:\/\//.test(row.url)).slice(0, limit)
  if (!usable.length) return MISS
  const resolved = []
  for (const row of usable.slice(0, RESOLVE_LIMIT)) {
    resolved.push({ ...row, url: await resolveUrl(row.url, fetchImpl, Math.min(timeoutMs, 5000)) })
  }
  return resolved.map((row) => `${row.url}\n${row.title ? `${row.title}：` : ''}${row.text}`).join('\n\n')
}

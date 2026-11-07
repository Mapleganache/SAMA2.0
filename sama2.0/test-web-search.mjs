import {
  isLibraryMiss,
  isWebMiss,
  parse360Html,
  parseBaiduHtml,
  parseBingHtml,
  searchWeb,
} from './webSearch.mjs'

const problems = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) problems.push(name)
}

const bing = `<ol id="b_results">
<li class="b_algo"><h2><a href="https://example.com/a">标题 A</a></h2><p>摘要 A</p></li>
<li class="b_algo"><h2><a href="https://www.bing.com/ck/a?!&amp;&amp;p=x&u=a1aHR0cHM6Ly9leGFtcGxlLmNvbS9i&amp;ntb=1">标题 B</a></h2><p>摘要 B</p></li>
</ol>`
const bingRows = parseBingHtml(bing)
check('Bing 解析两条', bingRows.length === 2)
check('Bing 跳转链接解码', bingRows[1]?.url === 'https://example.com/b', bingRows[1]?.url)

const so = `<ul class="result">
<li class="res-list"><h3 class="res-title"><a href="https://example.com/so1">360 结果一</a></h3><p class="res-desc">摘要一</p></li>
<li class="res-list"><h3 class="res-title"><a href="https://example.com/so2">360 结果二</a></h3><p class="res-desc">摘要二</p></li>
</ul>`
const soRows = parse360Html(so)
check('360 解析两条', soRows.length === 2 && soRows[0].url === 'https://example.com/so1')

const baidu = `<div class="result c-container"><h3 class="t"><a href="https://example.com/bd">百度结果</a></h3><div class="c-abstract">摘要</div></div>`
check('百度解析一条', parseBaiduHtml(baidu).length === 1)

check('精编命中不算缺失', isLibraryMiss('SQLite全量资料\nid: sqlite_curated:11') === false)
check('案例命中不算缺失', isLibraryMiss('id: sqlite_case:7') === false)
check('只有通用片段算缺失', isLibraryMiss('SQLite全量资料\nid: sqlite_fragment:12129') === true)
check('没有证据算缺失', isLibraryMiss('本地知识库没有该领域的文档。') === true)
check('不相关命中算缺失', isLibraryMiss('SQLite全量资料\\nid: sqlite_curated:12\\n静压轴承 油腔压力', 'FANUC 401 报警') === true)
check('相关命中不缺失', isLibraryMiss('SQLite全量资料\\nid: sqlite_curated:12\\n静压轴承 油腔压力升高不足', '静压轴承 油腔压力升高') === false)
check('联网空结果判定', isWebMiss('网页搜索没有返回带 URL 的结果。') === true)
check('联网有 URL 判定', isWebMiss('https://example.com/x\n标题：摘要') === false)

const stubFetch = async (url) => {
  if (String(url).includes('so.com/s')) {
    return { ok: true, url: String(url), text: async () => so.replace(/example\.com/g, 'real.example.com') }
  }
  return { ok: false, url: String(url), text: async () => '' }
}
const online = await searchWeb({ query: '主轴抱轴', fetchImpl: stubFetch, limit: 2 })
check('搜索链返回带 URL 结果', /^https?:\/\/real\.example\.com\/so1/m.test(online), online.slice(0, 60))

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\nweb search ok')


import { bridgeTerms, diversifyLaneQueries, extraTokens, firstQueryForLane, jaccard, laneTemperature, nextQueryFromHits, pathScore, runRetrievalTree } from './retrieval-tree.mjs'
import { resolveConfig } from './config.mjs'

const problems = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) problems.push(name)
}

const origin = '齿面粗糙度达不到要求，热机，磨削中'
check('粗糙度题补上爬行导轨', bridgeTerms(origin).includes('爬行') && bridgeTerms(origin).includes('导轨'))
check('第1路用原词', firstQueryForLane(origin, 0) === origin)
check('第2路带中间层', extraTokens(origin, firstQueryForLane(origin, 1)).some((item) => item.includes('爬') || item.includes('导')))
check('第3路不抄原句', jaccard(firstQueryForLane(origin, 2), origin) < 0.5)
check('第5路反热变形', /油品|润滑脂|导轨/.test(firstQueryForLane(origin, 4)) && !firstQueryForLane(origin, 4).includes('热变形'))

const queries = diversifyLaneQueries(origin, 5)
check('五路入口不是同一句', new Set(queries).size === 5)
check('后三路彼此不太重叠', jaccard(queries[2], queries[3]) < 0.5 && jaccard(queries[2], queries[4]) < 0.5)

const temps = [0, 1, 2, 3, 4].map((index) => laneTemperature(resolveConfig({}), index))
check('五路温度递增错开', temps[0] === 0.35 && temps[1] === 0.5 && temps[3] === 1 && temps[4] === 0.95)

check('路径分打折扣', pathScore([1, 1], 0.6) === 1.6)

const hop2 = nextQueryFromHits('齿面粗糙度', [{ title: '导轨爬行与润滑', snippet: '46号机械油抗爬性差' }])
check('第2跳从命中抽出爬行', hop2.includes('爬行') && hop2.includes('导轨') && !hop2.includes('粗糙'))

const store = [
  { id: 'sqlite_fragment:1', title: '表面粗糙度公差', snippet: 'Ra 参数表', score: 10 },
  { id: 'sqlite_fragment:2', title: '导轨爬行与润滑油', snippet: '机械油抗爬性差导致爬行', score: 8 },
  { id: 'sqlite_fragment:3', title: '砂轮修整', snippet: '修整间隔', score: 3 },
  { id: 'sqlite_fragment:4', title: '68号导轨油', snippet: '用导轨油替代机械油', score: 9 },
]
const tree = runRetrievalTree({
  origin,
  firstQuery: origin,
  searchFn: (query, extra) => {
    const rows = /爬行|导轨/.test(query)
      ? store.filter((row) => row.id !== 'sqlite_fragment:1')
      : store.filter((row) => row.id === 'sqlite_fragment:1' || row.id === 'sqlite_fragment:2')
    return rows.filter((row) => !extra?.excludeIds?.has(row.id))
  },
})
check('第2跳不重复第1跳条目', tree.hop2Query.includes('爬行') || tree.hop2Query.includes('导轨'))
check('树结果带引用编号', tree.records.some((row) => row.id.startsWith('sqlite_')) && tree.text.includes('id: sqlite_fragment:'))
check('路径分用了第二跳', tree.score > 8)

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\nretrieval tree ok')

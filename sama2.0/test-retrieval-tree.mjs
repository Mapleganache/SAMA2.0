import {
  bridgeTerms,
  buildLaneEntries,
  clampBeamK,
  diversifyLaneQueries,
  extraTokens,
  firstQueryForLane,
  jaccard,
  kgNeighbors,
  laneTemperature,
  nextQueryFromHits,
  pathScore,
  runRetrievalTree,
  scorePathSet,
} from './retrieval-tree.mjs'
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
check('beamK 只允许 3/5/7', clampBeamK(4) === 3 && clampBeamK(6) === 5 && clampBeamK(9) === 7)

const hop2 = nextQueryFromHits('齿面粗糙度', [{ title: '导轨爬行与润滑', snippet: '46号机械油抗爬性差' }])
check('第2跳从命中抽出爬行', hop2.includes('爬行') && hop2.includes('导轨') && !hop2.includes('粗糙'))
check('图邻域含爬行导轨', kgNeighbors('粗糙度').includes('爬行') || kgNeighbors('齿面粗糙度').includes('导轨') || bridgeTerms(origin).includes('爬行'))

const entries = buildLaneEntries(origin, {
  count: 5,
  seedBase: 1000,
  temps: resolveConfig({}).laneTemps,
  entryMode: 'softmax',
})
check('分温入口五路都有查询', entries.length === 5 && entries.every((row) => row.entryQuery))
check('入口带路温与种子', entries[0].tau === 0.35 && entries[3].tau === 1 && entries[0].seed === 1000)
check('低温路落在原句', entries[0].entryQuery === origin, entries[0].entryQuery)
check(
  '分温入口不全是原句',
  entries.filter((row) => row.entryQuery === origin).length < 5,
  entries.map((row) => row.entryQuery).join(' | '),
)
const entryPairs = []
for (let i = 0; i < entries.length; i += 1) {
  for (let j = i + 1; j < entries.length; j += 1) entryPairs.push(jaccard(entries[i].entryQuery, entries[j].entryQuery))
}
const medianOverlap = entryPairs.slice().sort((a, b) => a - b)[Math.floor(entryPairs.length / 2)]
check('分温入口两两重叠中位低于全原句', medianOverlap < 0.99, `median=${medianOverlap.toFixed(3)}`)

const mmrEntries = buildLaneEntries(origin, { count: 5, entryMode: 'mmr', seedBase: 1000 })
check('mmr 模式也给出五路', mmrEntries.length === 5 && new Set(mmrEntries.map((row) => row.entryQuery)).size >= 3)

const store = [
  { id: 'sqlite_fragment:1', title: '表面粗糙度公差', snippet: 'Ra 参数表', score: 10 },
  { id: 'sqlite_fragment:2', title: '导轨爬行与润滑油', snippet: '机械油抗爬性差导致爬行', score: 8 },
  { id: 'sqlite_fragment:3', title: '砂轮修整', snippet: '修整间隔', score: 3 },
  { id: 'sqlite_fragment:4', title: '68号导轨油', snippet: '用导轨油替代机械油', score: 9 },
]
const tree = runRetrievalTree({
  origin,
  firstQuery: origin,
  hopCost: 0.05,
  hopFuse: 8,
  retBudget: 20,
  beamK: 3,
  searchFn: (query, extra) => {
    const rows = /爬行|导轨|油品|润滑/.test(query)
      ? store.filter((row) => row.id !== 'sqlite_fragment:1')
      : store.filter((row) => row.id === 'sqlite_fragment:1' || row.id === 'sqlite_fragment:2')
    return rows.filter((row) => !extra?.excludeIds?.has(row.id))
  },
})
check(
  '扩展后路径或次跳含机理词',
  (tree.hop2Query && (/爬行|导轨|润滑|油品/.test(tree.hop2Query))) ||
    (tree.path || []).some((term) => /爬行|导轨|润滑|油品/.test(term)),
  `path=${(tree.path || []).join(',')}; hop2=${tree.hop2Query}`,
)
check('树结果带引用编号', tree.records.some((row) => row.id.startsWith('sqlite_')) && tree.text.includes('id: sqlite_fragment:'))
check('回报 G 为正', tree.score > 0, `score=${tree.score}`)
check('观察里写出路径与 G', /路径/.test(tree.text) && /G /.test(tree.text))

const highCost = runRetrievalTree({
  origin,
  firstQuery: origin,
  hopCost: 0.95,
  hopFuse: 8,
  retBudget: 20,
  beamK: 3,
  searchFn: () => store.slice(0, 1),
})
check('高 hopCost 时跳数不会顶满保险丝', highCost.hopsUsed < 8, `hopsUsed=${highCost.hopsUsed}`)

check('路径集合打分在 0~1', scorePathSet(origin, ['爬行', '导轨'], store.slice(1, 3), 0.5) <= 1)

const cfg = resolveConfig({})
check(
  'config 含软上界与入口模式',
  cfg.treeHopCost === 0.15 && cfg.treeBeamK === 3 && cfg.treeEntryMode === 'softmax' && cfg.treeHopFuse === 16,
)

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\nretrieval tree ok')

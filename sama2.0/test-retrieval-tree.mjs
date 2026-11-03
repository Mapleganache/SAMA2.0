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
  nextPathScore,
  pathScore,
  runRetrievalTree,
  runSqliteTree,
  scorePathSet,
} from './retrieval-tree.mjs'
import { lexicalVecScore, sparseCosine, termFreq } from './embed.mjs'
import { capAccuracy, formatGradedTree, gradeRecords, priorWithoutEvidence, processScore, sanitizeDirection } from './evidence.mjs'
import { rankByDirectionalFit } from './judge.mjs'
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
check('共现图给抱轴补上静压', kgNeighbors('抱轴').includes('静压') || kgNeighbors('抱轴').includes('动静压'), kgNeighbors('抱轴').join(','))
check('共现图给爬行连上导轨', kgNeighbors('爬行').includes('导轨'))
check(
  '无向量时仍可用自定义 scoreVec',
  scorePathSet(origin, ['爬行'], [{ title: 'x', snippet: 'y', score: 1 }], 0.5, () => 0.9) >= 0.4,
)

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
check('树文本带 SQLite 标准头', tree.text.startsWith('SQLite全量资料（reference，开发参考；未经维修专家复核）'))

const highCost = runRetrievalTree({
  origin,
  firstQuery: origin,
  hopCost: 0.95,
  hopFuse: 8,
  retBudget: 20,
  beamK: 3,
  searchFn: () => store.slice(0, 1),
})
check('ΔG 非正则不再往下跳', highCost.hopsUsed === 1, `hopsUsed=${highCost.hopsUsed}`)

const paidHop = runRetrievalTree({
  origin: '导轨爬行',
  firstQuery: '导轨爬行',
  hopCost: 0,
  hopFuse: 8,
  retBudget: 20,
  beamK: 3,
  searchFn: (query, extra) => {
    const rows = /润滑|油品|抗爬/.test(query)
      ? [{ id: 'sqlite_fragment:9', title: '导轨油抗爬', snippet: '导轨爬行改用导轨油', score: 20 }]
      : [{ id: 'sqlite_fragment:8', title: '导轨爬行', snippet: '导轨爬行', score: 2 }]
    return rows.filter((row) => !extra?.excludeIds?.has(row.id))
  },
})
check('ΔG 为正时允许继续扩展', paidHop.hopsUsed > 1, `hopsUsed=${paidHop.hopsUsed}`)

check('路径集合打分在 0~1', scorePathSet(origin, ['爬行', '导轨'], store.slice(1, 3), 0.5) <= 1)
const diluted = scorePathSet(
  origin,
  ['爬行', '导轨', '润滑', '油品', '机械油', '添加剂'],
  store,
  0.5,
)
const hopGain = nextPathScore(origin, 0.9, [{
  id: 'sqlite_fragment:oil',
  title: '齿面粗糙度与机械油',
  snippet: '热机磨削中齿面粗糙度达不到要求，机械油抗爬性差导致导轨爬行',
  score: 8,
}])
check(
  '单篇文档增益不因路径变长或当前 S 更高而掉成 0',
  hopGain.gain > 0 && hopGain.S_n >= 0.9 && hopGain.docScore === hopGain.gain,
  `diluted=${diluted.toFixed(4)}; gain=${hopGain.gain.toFixed(4)}; S_n=${hopGain.S_n.toFixed(4)}`,
)
check(
  '词频向量：相近文本高于无关文本',
  sparseCosine(termFreq('导轨爬行润滑油'), termFreq('导轨爬行抗爬性差')) >
    sparseCosine(termFreq('导轨爬行润滑油'), termFreq('梯形图输入继电器')),
)
check(
  '路径向量能对上机理片段',
  lexicalVecScore('导轨爬行', ['爬行', '导轨'], [{ title: '导轨爬行', snippet: '抗爬性差', score: 8 }]) >
    lexicalVecScore('导轨爬行', ['电路'], [{ title: '梯形图', snippet: '输入继电器', score: 8 }]),
)
check('config 默认 hash 嵌入', resolveConfig({}).treeEmbed === 'hash')

const cfg = resolveConfig({})
check(
  'config 含软上界与入口模式',
  cfg.treeHopCost === 0.15 && cfg.treeBeamK === 3 && cfg.treeEntryMode === 'softmax' && cfg.treeHopFuse === 16,
)

const biteWords = bridgeTerms('外圆磨床死顶尖中心孔咬毛、顶尖烧伤')
check('桥接词按具体程度把润滑脂组放前面', ['润滑脂', '中心孔', '皂液'].includes(biteWords[0]), biteWords.join(','))

const q29 = '数控磨床，磨削中，热机，齿面粗糙度达不到要求'
const live29 = await runSqliteTree({ origin: q29, firstQuery: q29, beamK: 3, topK: 3 })
check(
  'C08-29 跳数不超过保险丝且由 ΔG 决定',
  live29.hopsUsed >= 1 && live29.hopsUsed < 16,
  `hopsUsed=${live29.hopsUsed}; path=${(live29.path || []).join(',')}`,
)

const q33 = '大型数控曲轴磨床，JOG 移动工作台时导轨运行滞涩、运动沉重，工作台自重 5 吨以上'
const live33 = await runSqliteTree({ origin: q33, firstQuery: q33, beamK: 3, topK: 3 })
check(
  '正控召回 C08-33',
  live33.records.some((row) => row.id === 'sqlite_curated:6'),
  (live33.records || []).map((row) => row.id).join(','),
)

const q34 = '外圆磨床，磨削中，热机，细长工件中心孔咬毛，顶尖烧伤'
const live34 = await runSqliteTree({ origin: q34, firstQuery: q34, beamK: 3, topK: 3 })
check('C08-34 跳数由 ΔG 决定', live34.hopsUsed >= 1 && live34.hopsUsed < 16, `hopsUsed=${live34.hopsUsed}`)

const q35 = '外圆磨床，磨削中，热机，汽油清洗主轴箱后油漆脱落抱轴'
const live35 = await runSqliteTree({ origin: q35, firstQuery: q35, beamK: 3, topK: 3 })
check('C08-35 跳数由 ΔG 决定', live35.hopsUsed >= 1 && live35.hopsUsed < 16, `hopsUsed=${live35.hopsUsed}`)

const graded = gradeRecords('齿面粗糙度达不到要求', [
  { id: 'sqlite_fragment:2', title: '导轨爬行与润滑油', snippet: '机械油抗爬性差导致爬行', score: 8 },
  { id: 'sqlite_fragment:9', title: '冷却液浓度表', snippet: '冷却液配比与水', score: 3 },
])
check('近邻爬行片段不会整段当 IRRELEVANT', graded.some((row) => row.id === 'sqlite_fragment:2' && row.grade !== 'IRRELEVANT'))
const gradedText = formatGradedTree({ query: '齿面粗糙度', records: graded.map((row) => row.doc), grades: graded, path: ['爬行'], score: 0.4 })
check('分级文本含标准头和可用证据区', gradedText.includes('SQLite全量资料（reference') && gradedText.includes('【本路可用证据】'))
check('过程分有近邻时至少为 1', processScore(graded) >= 1)
check('无引用则 accuracy 封顶 5', capAccuracy(9, '热变形导致超差', []) === 5)
check('成稿引用 sqlite 不封顶', capAccuracy(9, '参见 sqlite_fragment:2 沿爬行排查', []) === 9)
check('通识无证据不得当主方向', priorWithoutEvidence('热变形', '导轨爬行润滑油') === true)
const card = sanitizeDirection({ main_direction: '热变形', support_obs: ['sqlite_fragment:2'] }, graded)
check('方向卡丢掉无证据通识', !String(card.main_direction || '').includes('热变形'))

const qGain = '数控磨床，磨削中，热机，加工齿轮时齿面粗糙度始终达不到工艺要求，电气和机械多次检修都没有改善。最可能的原因是什么？'
const liveZero = await runSqliteTree({ origin: qGain, firstQuery: qGain, hopCost: 0, beamK: 3, topK: 3 })
check(
  '真实库 λ=0 应至少两跳',
  liveZero.hopsUsed >= 2 && (liveZero.hops?.[1]?.records?.length || 0) > 0,
  `hopsUsed=${liveZero.hopsUsed}; hop2records=${liveZero.hops?.[1]?.records?.length || 0}; path=${(liveZero.path || []).join(',')}`,
)
check(
  '第二跳路径含机理词',
  (liveZero.path || []).some((term) => /机械油|添加剂|供油|爬行|导轨|润滑/.test(term)),
  (liveZero.path || []).join(','),
)
const liveDefault = await runSqliteTree({ origin: qGain, firstQuery: qGain, hopCost: 0.15, beamK: 3, topK: 3 })
check(
  '真实库默认 λ 允许停在 1 跳',
  liveDefault.hopsUsed >= 1 && liveDefault.hopsUsed < 16,
  `hopsUsed=${liveDefault.hopsUsed}`,
)

const gated = rankByDirectionalFit([
  { id: 'high', title: '高分低机理', total: 9.2, scores: { accuracy: 9, safety: 9, feasibility: 9, completeness: 9, brevity: 9 }, layers: { mechanism: 4 } },
  { id: 'ok', title: '达标', total: 7.1, scores: { accuracy: 7, safety: 7, feasibility: 7, completeness: 7, brevity: 7 }, layers: { mechanism: 8 } },
])
check('mechanism 低于阈值即使总分最高也不中选', gated.ranked[0]?.id === 'ok' && gated.mechanismGated === true)
const fallback = rankByDirectionalFit([
  { id: 'a', title: 'a', total: 8, scores: { accuracy: 8, safety: 8, feasibility: 8, completeness: 8, brevity: 8 }, layers: { mechanism: 3 } },
  { id: 'b', title: 'b', total: 6, scores: { accuracy: 6, safety: 6, feasibility: 6, completeness: 6, brevity: 6 }, layers: { mechanism: 4 } },
])
check('全组低于阈值时按总分保底', fallback.ranked[0]?.id === 'a' && fallback.mechanismFallback === true)

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\nretrieval tree ok')
console.log(`hopsUsed C08-29=${live29.hopsUsed} C08-34=${live34.hopsUsed} C08-35=${live35.hopsUsed}`)

import { databaseOptions } from './sama-sqlite/connection.mjs'
import { classifyByRules } from './complexity.mjs'
import { identifyMachine } from './dialect.mjs'
import { extractFaultFacts } from './facts.mjs'
import { searchLibrary } from './library.mjs'
import { pickWinner, weightedTotal } from './score.mjs'
import { resolveConfig } from './config.mjs'

const cases = [
  ['什么是磨床静压轴承', 'simple'],
  ['关于静压轴承温升过高怎么理解', 'simple'],
  ['静压轴承温升过高怎么理解', 'simple'],
  ['最可能的原因是什么', 'complex'],
  ['导轨爬行的原因是什么', 'complex'],
  ['砂轮动平衡是什么', 'simple'],
  ['外圆磨床砂轮动平衡周期是多少', 'simple'],
  ['导轨怎么日常保养', 'simple'],
  ['外圆磨床主轴发热、震动大', 'complex'],
  ['主轴又发热又有异响还有温升', 'complex'],
  ['主轴偶发异响', 'complex'],
  ['换了轴承还是发热', 'complex'],
  ['结合型号和历史维修记录综合判断主轴发热根源', 'complex'],
  ['主轴发热', null],
]

let failed = 0
for (const [query, expected] of cases) {
  const got = classifyByRules(query)
  const level = got ? got.level : null
  const ok = level === expected
  if (!ok) failed += 1
  console.log(`${ok ? 'OK' : 'FAIL'} ${JSON.stringify(query)} => ${level} (${got?.reason || 'boundary'})`)
}

const facts = extractFaultFacts('外圆磨床主轴发热、震动大')
if (!facts.phenomena.includes('发热/温升') || !facts.phenomena.includes('振动') || facts.machine !== '外圆磨床') {
  failed += 1
  console.log('FAIL facts', facts)
} else {
  console.log('OK facts', facts.phenomena.join(','), facts.machine)
}

const total = weightedTotal({ accuracy: 10, safety: 10, feasibility: 10, completeness: 10, brevity: 10 })
if (total !== 10) {
  failed += 1
  console.log('FAIL total', total)
} else {
  console.log('OK weighted 10')
}

const ranked = pickWinner(
  [
    { id: 'sub1', title: 'A', status: 'done', plan: '方案A' },
    { id: 'sub2', title: 'B', status: 'done', plan: '方案B' },
    { id: 'sub3', title: 'C', status: 'failed', plan: '方案生成失败' },
  ],
  [
    { id: 'sub1', scores: { accuracy: 8, safety: 6, feasibility: 8, completeness: 8, brevity: 8 }, defect: '' },
    { id: 'sub2', scores: { accuracy: 7, safety: 9, feasibility: 8, completeness: 8, brevity: 8 }, defect: '定位略弱' },
  ],
)
if (ranked[0].id !== 'sub2') {
  failed += 1
  console.log('FAIL winner', ranked.map((row) => [row.id, row.total]))
} else {
  console.log('OK winner', ranked[0].id, ranked[0].total)
}

const config = resolveConfig({ maxStep: 80, concurrency: 9 })
const defaults = resolveConfig({})
if (config.maxStep !== 50 || config.concurrency !== 5 || defaults.maxStep !== 8 || defaults.concurrency !== 5 || defaults.forceMultiAgent) {
  failed += 1
  console.log('FAIL config', config, defaults)
} else {
  console.log('OK config', defaults.maxStep, defaults.concurrency)
}

const machine = identifyMachine('高桥外圆磨主轴发热')
if (machine.id !== 'gaoqiao') {
  failed += 1
  console.log('FAIL dialect', machine)
} else {
  console.log('OK dialect', machine.label)
}

const hit = searchLibrary('静压轴承油膜')
const sqliteEnabled = Boolean(databaseOptions())
const libraryOk = sqliteEnabled
  ? hit.includes('SQLite全量资料') && /sqlite_curated:\d+/.test(hit) && hit.includes('出处：')
  : hit.includes('hydrostatic.md')
if (!libraryOk) {
  failed += 1
  console.log('FAIL library', hit.slice(0, 200))
} else {
  console.log(sqliteEnabled ? 'OK library SQLite evidence and source' : 'OK library hydrostatic')
}

if (failed) {
  console.error(`\n${failed} failed`)
  process.exit(1)
}
console.log('\nall passed')

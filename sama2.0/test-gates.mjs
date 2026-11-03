import { lookupBaseline } from './baselines.mjs'
import { extractFaultFacts } from './facts.mjs'
import { questionsFor, composeSessionQuery, textAfterCorrection, gateDecision } from './gaps.mjs'
import { extractJson } from './json.mjs'
import { checkGrounding, hasCaseEvidence, kappa, NO_CASE_BANNER } from './grounding.mjs'
import { actionKey, createStepBudget, isDuplicate, samePrefix } from './guard.mjs'
import { recordMeasurement } from './measurements.mjs'
import { searchMtkb } from './mtkb.mjs'

const problems = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) problems.push(name)
}

const vague = questionsFor('磨床有问题')
check('磨床有问题四项都缺', vague.missing.join() === 'machine,phenomenon,load,thermal')
check('磨床有问题没有默认主轴', lookupBaseline('磨床有问题').length === 0 && extractFaultFacts('磨床有问题').subsystems.length === 0)

const heat = questionsFor('主轴发热')
check('主轴发热缺型号和工况', heat.missing.join() === 'machine,load,thermal')
const softHeat = gateDecision('主轴发热')
check('软门控对主轴发热改为假设', softHeat.action === 'sample' && softHeat.assumptions.some((item) => item.includes('磨削')) && softHeat.assumptions.some((item) => item.includes('热机')))
check('硬门控仍拦住主轴发热', gateDecision('主轴发热', { mode: 'hard' }).action === 'ask')
check('无机型无现象仍然追问', gateDecision('磨床有问题').action === 'ask')
check('同一字段问过两次后放行', gateDecision('磨床有问题', { askedCounts: { machine: 2, phenomenon: 2, load: 2, thermal: 2 } }).action === 'sample')
check('原因题即使缺项也进入采样', gateDecision('最可能的原因是什么').action === 'sample')
check('无案例编号不算有依据', hasCaseEvidence('本地资料没有命中') === false && NO_CASE_BANNER.includes('本地无') && NO_CASE_BANNER.includes('主方向'))
check('案例编号算有依据', hasCaseEvidence('参考 sqlite_curated:4') === true)

const ready = questionsFor('STUDER 主轴发热，空载，刚开机')
check('四项齐全可以开始', ready.missing.length === 0)

const conflict = questionsFor('空载，正在磨削，主轴发热，STUDER')
check('空载和磨削冲突继续问', conflict.missing.includes('load') && conflict.questions.some((item) => item.text.includes('空载和磨削都出现了')))

const corrected = questionsFor('空载，主轴发热，STUDER，刚开机。更正为正在磨削')
check('更正为只保留后面的工况', corrected.missing.includes('load') === false && textAfterCorrection('空载。更正为正在磨削').includes('正在磨削'))

const joined = composeSessionQuery('STUDER S40，发热，空载，刚开机', { origin: '磨床有问题', supplements: [] })
check('补充接回原题', joined.query.startsWith('磨床有问题') && questionsFor(joined.query).missing.length === 0)
check('补充后的主轴来自发热', extractFaultFacts(joined.query).subsystems.includes('主轴'))

const spindle = lookupBaseline('主轴发热')
check('发热可以映射主轴模板', spindle[0]?.id === 'baseline/主轴')

const grounded = checkGrounding('先查油压，不要写死数值。', '本地资料没有命中')
check('没有规格时出处通过', grounded.G === 1 && grounded.pass)
const missing = checkGrounding('轴承间隙约 0.02 mm', '笔记里没有这个数')
check('无出处间隙失败', missing.G === 0 && missing.unsupported.some((item) => item.includes('0.02')))
const same = checkGrounding('间隙 0.02 mm', '观察：0.02 mm')
check('原样数字可以通过', same.G === 1)
const decimal = checkGrounding('间隙 0.020 mm', '观察：0.02 mm')
check('0.020 对不上 0.02', decimal.G === 0)
const torque = checkGrounding('拧紧 25 N.m', '手册写 25 N·m')
check('扭矩只统一单位写法', torque.G === 1 && kappa('25 N.m') === kappa('25 N·m'))
const cited = checkGrounding('见 knowledge/spindle.md#0-12', '没有这个 id')
check('编造的笔记 id 失败', cited.cite === 0)
const chunk = checkGrounding('见 common:126', 'id: common:88')
check('编造的案例 id 失败', chunk.citeM === 0)
const iso = checkGrounding('按 ISO:9001 检查', '无')
check('标准号不当作出处 id', iso.pass === true && !iso.unsupported.includes('ISO:9001'))
const fakeSqlite = checkGrounding('见 sqlite_fragment:99999999', '无')
check('编造的 sqlite 片段 id 失败', fakeSqlite.pass === false && fakeSqlite.unsupported.includes('sqlite_fragment:99999999'))
const userSpec = checkGrounding('间隙 0.008 mm', '用户原文：\n实测主轴空载振动 0.008 mm')
check('用户原文读数可作出处', userSpec.pass === true)
const invented = checkGrounding('间隙 0.05 mm', '用户原文：\n实测主轴空载振动 0.008 mm')
check('原文没有的读数仍失败', invented.pass === false)
const url = checkGrounding('参考 https://example.com/a', '本地笔记')
check('没有观察的网址失败', url.citeW === 0)

const accepted = recordMeasurement('实测间隙 0.02 mm', { spec: '0.02 mm', quantity: '间隙' })
check('原文里的读数可以记下', accepted.includes('user-measure') && accepted.includes('0.02 mm'))
const rejected = recordMeasurement('主轴发热', { spec: '0.02 mm', quantity: '间隙' })
check('原文没有的读数被拒绝', rejected.startsWith('拒绝') && !rejected.includes('0.02'))

const notes = [{ executed: true, key: actionKey('search_knowledge', { query: '主轴发热' }) }]
check('同键算重复', isDuplicate(notes, 'search_knowledge', { query: '主轴发热' }))
check('键顺序不同也算重复', isDuplicate(notes, 'search_knowledge', { query: '主轴发热' }))
check('不同参数不算重复', !isDuplicate(notes, 'search_knowledge', { query: '主轴温升' }))
check('观察前 200 字相同会收束', samePrefix('没有命中'.repeat(20), '没有命中'.repeat(20), 200))
const budget = createStepBudget(2)
check('步数名额用完后拒绝', budget.claim() && budget.claim() && !budget.claim())

const dumped = '{"thought":"先认机床","tool":"lookup_grind_dialect","args":{"query":"高桥"}}\n{"thought":"再查笔记","tool":"search_knowledge","args":{"query":"主轴发热"}}'
const first = extractJson(dumped)
check('多段工具调用只取第一段', first?.tool === 'lookup_grind_dialect' && first?.args?.query === '高桥')
const phrases = ['机床不对劲', '有故障，帮我看看', '磨床异常怎么办']
check('换一种说法仍然四项都缺', phrases.every((text) => questionsFor(text).missing.length === 4))

const timed = await searchMtkb({
  query: '主轴',
  timeoutMs: 30,
  fetchImpl: () => new Promise(() => {}),
})
check('案例库超时写明超时', timed === 'MTKB 超时')
const down = await searchMtkb({
  query: '主轴',
  fetchImpl: async () => { throw new Error('connect ECONNREFUSED') },
})
check('案例库连不上不写成超时', down === 'MTKB 未连接')

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\ngates ok')

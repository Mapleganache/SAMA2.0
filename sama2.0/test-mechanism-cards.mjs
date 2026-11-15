import { diagnosisStatus, fitScore, gradeRecord, processScore } from './evidence.mjs'
import {
  affirmativeHit,
  againstDecision,
  CARDS,
  CARD_FIT_BONUS,
  cardFitBonus,
  ensureTwoSections,
  isGrindDomain,
  rankCards,
  shouldAskDiscriminate,
  CAUSE_HEADING,
  METHOD_HEADING,
} from './mechanism-cards.mjs'

const problems = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) problems.push(name)
}

check('两张卡对上导轨和主轴', CARDS.map((row) => row.id).join() === 'guide-lube-crawl,spindle-oil-heat')
check('磨床域认外圆磨', isGrindDomain('外圆磨床齿面粗糙度差') === true)
check('加工中心不算磨床域', isGrindDomain('加工中心主轴不平衡，刀库换刀失败') === false)
check('机型未知不算磨床域', isGrindDomain('主轴发热并且振动') === false)

const oilNeg = '数控磨床齿面粗糙度达不到要求，没有换过导轨油，冷机不差'
check('否定句不当作已换油', affirmativeHit(oilNeg, '已换导轨油') === false)
check('没有换了导轨油只降权', againstDecision('数控磨床没有换了导轨油', { keys: ['换了导轨油'] }) === 'soft')
check('已换导轨油才 veto', againstDecision('数控磨床已换导轨油且低速平稳', { keys: ['已换导轨油'] }) === 'veto')

const rankedNeg = rankCards(oilNeg, { allowVeto: true })
const guide = rankedNeg.find((row) => row.id === 'guide-lube-crawl')
check('没有换过导轨油不否决导轨卡', guide && guide.score > 0 && guide.vetoed === false)

const rankedWheel = rankCards('数控磨床齿面有振纹，振纹频率随砂轮转速走', { allowVeto: true })
check(
  '振纹随砂轮转速否决导轨卡',
  rankedWheel.find((row) => row.id === 'guide-lube-crawl')?.vetoed === true,
)

const origin = '数控磨床齿面粗糙度达不到要求，热机，磨削中'
const crawlDoc = { title: '导轨爬行与润滑油', snippet: '机械油抗爬性差导致爬行' }
const coolDoc = { title: '冷却液浓度表', snippet: '冷却液配比与水' }
const baseFit = fitScore(origin, crawlDoc)
const gradedOff = gradeRecord(origin, crawlDoc, { cardsEnabled: false })
const gradedOn = gradeRecord(origin, crawlDoc, { cardsEnabled: true })
check('关卡时附加分不进入 fitScore', Math.abs(baseFit - Number(gradedOff.fit)) < 1e-6)
check('开卡且磨床域才加附加分', Math.abs(gradedOn.fit - Number((baseFit + CARD_FIT_BONUS).toFixed(4))) < 1e-6)
check('非磨床文档不因卡片改主分', cardFitBonus('加工中心主轴发热', crawlDoc, { cardsEnabled: true }) === 0)
check('冷却液文档不吃导轨附加分', cardFitBonus(origin, coolDoc, { cardsEnabled: true }) === 0)

const emptyStatus = diagnosisStatus({ route: 'complex', grades: [], evidenceBlob: '', processScore: 0 })
check('全空 complex 为 unknown', emptyStatus.status === 'unknown')
check('simple 不走 unknown', diagnosisStatus({ route: 'simple', grades: [], processScore: 0 }).status === 'n/a')
const structured = diagnosisStatus({
  route: 'complex',
  grades: [{ id: 'sqlite_fragment:1', grade: 'SUPPORT' }],
  evidenceBlob: '类型：案例条目\nid: sqlite_fragment:1',
  processScore: 2,
})
check('结构化命中是 confirmed', structured.status === 'confirmed')
check('只有 NEAR 是 provisional', diagnosisStatus({
  route: 'complex',
  grades: [{ id: 'sqlite_fragment:2', grade: 'NEAR' }],
  processScore: 1,
}).status === 'provisional')
check('IRRELEVANT 过程分为 0', processScore([{ grade: 'IRRELEVANT' }]) === 0)

const twoCards = '数控磨床齿面粗糙、主轴发热，热机，磨削中'
const ask = shouldAskDiscriminate({
  query: twoCards,
  grades: [{ id: 'x', grade: 'IRRELEVANT' }],
  facts: { machine: '数控磨床' },
  askedCounts: {},
  cardsOn: true,
})
check('双卡且无 SUPPORT 才问鉴别', Boolean(ask?.text) && ask.id === 'discriminate')
check(
  '有结构化 SUPPORT 不问',
  shouldAskDiscriminate({
    query: twoCards,
    grades: [{ id: 'sqlite_fragment:9', grade: 'SUPPORT' }],
    facts: { machine: '数控磨床' },
    cardsOn: true,
  }) == null,
)
check(
  '加工中心不问磨床鉴别',
  shouldAskDiscriminate({
    query: '加工中心主轴发热、刀库换刀失败',
    grades: [],
    cardsOn: true,
  }) == null,
)
check(
  '问过一次不再问',
  shouldAskDiscriminate({
    query: twoCards,
    grades: [],
    facts: { machine: '数控磨床' },
    askedCounts: { discriminate: 1 },
    cardsOn: true,
  }) == null,
)

const stub = ensureTwoSections('第1路的完整维修方案')
check('缺标题时程序补两节', stub.includes(CAUSE_HEADING) && stub.includes(METHOD_HEADING) && stub.includes('第1路的完整维修方案'))
const unknownText = ensureTwoSections('准备拆主轴并更换砂轮', { unknown: true })
check('unknown 去掉拆卸换件', unknownText.includes('无法可靠') && !/拆主轴/.test(unknownText) && !/更换砂轮/.test(unknownText))
check('已有两节不再重复插入', ensureTwoSections(`${CAUSE_HEADING}\n因\n\n${METHOD_HEADING}\n法`).split('原因（待验证）').length === 2)

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\nmechanism cards ok')

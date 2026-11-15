/**
 * CG-Rank：条件门控选优。不打真实模型。
 */
import { normalizeScores } from './score.mjs'
import {
  buildEvidenceIndex,
  evidenceState,
  extractPlanEvidence,
  fusePlanScore,
  packHasEntity,
  rankScored,
} from './scorer.mjs'

const problems = []
function check(name, ok, detail = '') {
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) problems.push(name)
}

function plan(id, text) {
  return { id, title: id, plan: text, status: 'done' }
}

function row(id, scores, layers = { mechanism: 8, measure: 7, uncertainty: 6 }) {
  return { id, title: id, scores: normalizeScores(scores), layers, processScore: 1 }
}

function even(n) {
  return { accuracy: n, safety: n, feasibility: n, completeness: n, brevity: n }
}

function fuse({ id, text, pack, scores, llmAccuracy, precise }) {
  const index = buildEvidenceIndex(pack)
  const item = plan(id, text)
  const feature = extractPlanEvidence(item, index)
  return fusePlanScore({
    plan: item,
    row: row(id, scores),
    feature,
    llmAccuracy: llmAccuracy ?? scores.accuracy,
    precise: precise ?? packHasEntity(index),
  })
}

const holdoutPack = [
  { id: 'sqlite_fragment:204412', grade: 'SUPPORT', fit: 0.5 },
  { id: 'sqlite_fragment:1', grade: 'NEAR', fit: 0.3 },
  { id: 'sqlite_fragment:2', grade: 'NEAR', fit: 0.25 },
  { id: 'sqlite_fragment:3', grade: 'NEAR', fit: 0.2 },
  { id: 'sqlite_fragment:4', grade: 'NEAR', fit: 0.2 },
]

const holdoutIndex = buildEvidenceIndex(holdoutPack)
check('库外包没有实体条目', packHasEntity(holdoutIndex) === false)

const citedHoldout = extractPlanEvidence(
  plan('cite', '参考 sqlite_fragment:204412 做泛化排查'),
  holdoutIndex,
)
check(
  'coverage = 0.7 包覆盖 + 0.3 SUPPORT 覆盖',
  citedHoldout.packCoverage === 0.2 && citedHoldout.supportRatio === 1 && Math.abs(citedHoldout.coverage - 0.44) < 1e-6,
  `pack=${citedHoldout.packCoverage} support=${citedHoldout.supportRatio} C=${citedHoldout.coverage}`,
)
check('任意 SUPPORT 仍是 tier 2', citedHoldout.tier === 2)

const weakCite = fuse({
  id: 'cite',
  text: '参考 sqlite_fragment:204412 做泛化排查',
  pack: holdoutPack,
  scores: { accuracy: 8, safety: 6, feasibility: 6, completeness: 6, brevity: 6 },
})
const strongPlain = fuse({
  id: 'good',
  text: '主方向是润滑不足，待验证。不引用泛化片段。',
  pack: holdoutPack,
  scores: even(9),
})
check('库外泛化 SUPPORT 不覆盖总分', weakCite.evidence.override === false && weakCite.evidence.state !== 'CORRECT')
check('无引用高分稿状态为 WEAK', strongPlain.evidence.state === 'WEAK' && strongPlain.evidence.override === false)

const holdoutRank = rankScored([weakCite, strongPlain])
check(
  '库外影子模式按总分选，泛化引用不能夺冠',
  holdoutRank.shadow === true && holdoutRank.ranked[0].id === 'good',
  holdoutRank.ranked.map((item) => `${item.id}:${item.total}:${item.evidence.state}`).join(','),
)

const entityPack = [
  { id: 'CASE-88', grade: 'SUPPORT', fit: 0.8 },
  { id: 'sqlite_fragment:10', grade: 'NEAR', fit: 0.3 },
  { id: 'sqlite_fragment:11', grade: 'NEAR', fit: 0.25 },
  { id: 'sqlite_fragment:12', grade: 'NEAR', fit: 0.2 },
  { id: 'sqlite_fragment:13', grade: 'NEAR', fit: 0.2 },
]
check('库内包识别到实体', packHasEntity(buildEvidenceIndex(entityPack)) === true)

const entityCite = fuse({
  id: 'entity',
  text: '按 CASE-88 的油腔堵塞处理。',
  pack: entityPack,
  scores: even(6),
})
const entityMiss = fuse({
  id: 'miss',
  text: '文笔很好但不引用本机案例。',
  pack: entityPack,
  scores: even(9),
})
check('引用实体是 CORRECT 且允许覆盖', entityCite.evidence.state === 'CORRECT' && entityCite.evidence.override === true)
const entityRank = rankScored([entityCite, entityMiss])
check(
  'tier 3 仍压过未引用实体的高总分',
  entityRank.shadow === false && entityRank.ranked[0].id === 'entity',
  entityRank.ranked.map((item) => `${item.id}:${item.evidence.tier}:${item.total}`).join(','),
)

const fake = fuse({
  id: 'fake',
  text: '见 sqlite_fragment:99999999 和 CASE-ghost',
  pack: entityPack,
  scores: even(9),
  llmAccuracy: 9,
})
check('伪造 id 把 accuracy 封到 4', fake.scores.accuracy <= 4 && fake.evidence.contradiction > 0)
check('伪造 id 不能进入推荐', fake.eligible === false && fake.recommendable === false)

const manySupport = [
  { id: 'CASE-1', grade: 'SUPPORT', fit: 0.7 },
  ...Array.from({ length: 9 }, (_, i) => ({ id: `sqlite_fragment:${200 + i}`, grade: 'SUPPORT', fit: 0.5 })),
]
const thinCite = fuse({
  id: 'thin',
  text: '参考 sqlite_fragment:200。',
  pack: manySupport,
  scores: { accuracy: 8, safety: 6, feasibility: 6, completeness: 6, brevity: 6 },
})
const highTotal = fuse({
  id: 'high',
  text: '方向对但不引用。',
  pack: manySupport,
  scores: even(9),
})
check(
  '有实体但只引 1/10 SUPPORT 仍是 WEAK，不覆盖',
  thinCite.evidence.tier === 2
    && thinCite.evidence.coverage <= 0.1
    && thinCite.evidence.state === 'WEAK'
    && thinCite.evidence.override === false,
  `C=${thinCite.evidence.coverage} E=${thinCite.evidence.score} state=${thinCite.evidence.state}`,
)
const thinRank = rankScored([thinCite, highTotal])
check(
  'WEAK 即使包内有实体也不字典序夺冠',
  thinRank.shadow === true && thinRank.ranked[0].id === 'high',
  thinRank.ranked.map((item) => item.id).join(','),
)

const ambigPack = [
  { id: 'CASE-2', grade: 'NEAR', fit: 0.3 },
  { id: 'sqlite_fragment:301', grade: 'SUPPORT', fit: 0.6 },
  { id: 'sqlite_fragment:302', grade: 'SUPPORT', fit: 0.55 },
]
const ambigCite = fuse({
  id: 'ambig',
  text: '见 sqlite_fragment:301 与 sqlite_fragment:302。',
  pack: ambigPack,
  scores: even(6),
})
const ambigPlain = fuse({
  id: 'plain',
  text: '不引用。',
  pack: ambigPack,
  scores: even(9),
})
check(
  '有实体且 SUPPORT 覆盖达标是 AMBIG，允许覆盖',
  ambigCite.evidence.state === 'AMBIG' && ambigCite.evidence.override === true && ambigCite.recommendable === true,
  `state=${ambigCite.evidence.state} C=${ambigCite.evidence.coverage} E=${ambigCite.evidence.score}`,
)
const ambigRank = rankScored([ambigCite, ambigPlain])
check('AMBIG 在 precise=1 时可以覆盖高总分', ambigRank.shadow === false && ambigRank.ranked[0].id === 'ambig')

const holdoutAmbig = fuse({
  id: 'out',
  text: '见 sqlite_fragment:204412。',
  pack: holdoutPack,
  scores: even(6),
})
check(
  '同样 AMBIG 在无实体包上不得覆盖',
  holdoutAmbig.evidence.state === 'AMBIG' && holdoutAmbig.evidence.override === false,
)

check(
  'WEAK 的 accuracy 不超过 6.5',
  strongPlain.scores.accuracy <= 6.5,
  String(strongPlain.scores.accuracy),
)
check(
  'evidenceState：tier2 低覆盖是 WEAK',
  evidenceState({ tier: 2, coverage: 0.1, contradiction: 0 }, 4.3) === 'WEAK',
)
check(
  'evidenceState：tier2 覆盖达标是 AMBIG',
  evidenceState({ tier: 2, coverage: 0.3, contradiction: 0 }, 5) === 'AMBIG',
)
check('evidenceState：tier3 是 CORRECT', evidenceState({ tier: 3, coverage: 0.1, contradiction: 0 }, 4) === 'CORRECT')

if (problems.length) {
  console.error(`\n${problems.length} failed: ${problems.join('、')}`)
  process.exit(1)
}
console.log('\nscorer ok')


import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { buildBrief } from './brief.mjs'
import { resolveConfig } from './config.mjs'
import { classifyByRules } from './complexity.mjs'
import { extractFaultFacts } from './facts.mjs'
import { collectQuestions, composeSessionQuery, gateDecision, questionsFor } from './gaps.mjs'
import { checkGrounding, evidenceText, hasCaseEvidence, isFailedPlan, NO_CASE_BANNER } from './grounding.mjs'
import { createStepBudget } from './guard.mjs'
import { safetyOnly } from './judge.mjs'
import { logEvent } from './log.mjs'
import { classifyComplexity } from './mainAgent.mjs'
import { buildRubric } from './rubric.mjs'
import { createToolRunner } from './tools.mjs'
import { finishNeedInfo, finishSimple, flowFor, pack, sampleWave, verifyPlans } from './stages.mjs'

const DiagnosisState = Annotation.Root({
  options: Annotation(),
  started: Annotation(),
  config: Annotation(),
  query: Annotation(),
  sessionQuery: Annotation(),
  facts: Annotation(),
  hard: Annotation(),
  complexity: Annotation(),
  brief: Annotation(),
  plans: Annotation(),
  asked: Annotation(),
  assumptions: Annotation(),
  gatePending: Annotation(),
  need: Annotation(),
  next: Annotation(),
  result: Annotation(),
})

async function intake(state) {
  const { options, started } = state
  const config = resolveConfig(options)
  const sessionQuery = composeSessionQuery(options.userText || options.query || '', options.session)
  const query = sessionQuery.query
  if (!query) {
    const error = new Error('请输入磨床故障或问题')
    error.code = 'EMPTY_QUERY'
    throw error
  }
  const facts = extractFaultFacts(query)
  logEvent('start', { chars: query.length, force: config.forceMultiAgent, maxStep: config.maxStep })
  const hard = classifyByRules(query)
  const base = { config, sessionQuery, query, facts, hard, brief: null }

  const gate = gateDecision(query, { mode: config.gateMode, askedCounts: sessionQuery.askedCounts || {} })
  if (!config.forceMultiAgent && (hard?.level === 'simple' || gate.action === 'answer')) {
    const complexity = hard?.level === 'simple'
      ? hard
      : { level: 'simple', reason: '这是知识或理解问题，没有故障排查需求', source: 'hard' }
    return { ...base, complexity, assumptions: [], gatePending: [], next: 'simple' }
  }

  const gap = questionsFor(query)
  const stillBlocking = gate.missing.some((id) => (sessionQuery.askedCounts?.[id] || 0) < 2)
  if (gate.action === 'ask' || (config.forceMultiAgent && gate.missing.length && stillBlocking)) {
    const complexity = config.forceMultiAgent
      ? { level: 'complex', reason: 'force_multi_agent 已开启，但必填项还没齐', source: 'force' }
      : hard?.level === 'complex'
        ? hard
        : { level: 'boundary', reason: '必填项不齐，先向用户补充，不调用分类模型', source: 'hard' }
    return {
      ...base,
      complexity,
      assumptions: [],
      gatePending: [],
      next: 'need_info',
      need: {
        query,
        facts,
        complexity,
        gap,
        plans: [],
        config,
        started,
        origin: sessionQuery.origin,
        supplements: sessionQuery.supplements.filter((item) => item.text && item.text !== sessionQuery.origin),
        askedCounts: sessionQuery.askedCounts || {},
      },
    }
  }

  const assumptions = gate.assumptions || []
  const gatePending = gate.pending || []
  const notedFacts = assumptions.length
    ? { ...facts, constraints: [...(facts.constraints || []), ...assumptions] }
    : facts
  const carried = { ...base, facts: notedFacts, assumptions, gatePending }
  if (config.forceMultiAgent) {
    return { ...carried, complexity: { level: 'complex', reason: 'force_multi_agent 已开启，跳过复杂度判断', source: 'force' }, next: 'main_brief' }
  }
  if (hard?.level === 'complex') return { ...carried, complexity: hard, next: 'main_brief' }
  return { ...carried, next: 'classify' }
}

async function simpleNode(state) {
  const hard = state.complexity?.level === 'simple' ? state.complexity : state.hard
  const result = await finishSimple({
    query: state.query,
    facts: state.facts,
    hard,
    options: state.options,
    config: state.config,
    started: state.started,
  })
  return { result }
}

function needInfoNode(state) {
  return { result: finishNeedInfo(state.need) }
}

async function classifyNode(state) {
  const complexity = await classifyComplexity(state.query, { llmTimeoutMs: state.config.llmTimeoutMs })
  if (complexity.level === 'simple') return { complexity, next: 'simple' }
  return { complexity: { ...complexity, level: 'boundary' }, next: 'main_brief' }
}

async function briefNode(state) {
  const { query, facts, complexity, config } = state
  if (!config.briefEnabled) return { brief: null, next: 'sample' }
  const brief = await buildBrief({
    query,
    facts,
    complexity,
    timeoutMs: config.llmTimeoutMs,
  })
  logEvent('brief', {
    ok: Boolean(brief.ok),
    hypotheses: brief.hypotheses?.length || 0,
    mustCheck: brief.mustCheck?.length || 0,
    source: brief.source || '',
  })
  return { brief, next: 'sample' }
}

async function sampleNode(state) {
  const { query, config, facts, complexity, sessionQuery, started, brief } = state
  const budget = createStepBudget(config.sampleCount * config.maxStep)
  const runTool = createToolRunner({ query, facts, allowWeb: config.allowWeb, mtkbUrl: config.mtkbUrl })
  let plans = []
  let waves = 0
  if (complexity.level === 'complex') {
    plans = await sampleWave({
      query,
      count: config.sampleCount,
      start: 0,
      config,
      budget,
      runTool,
      supplements: sessionQuery.supplements,
      wave: ++waves,
      brief,
      assumptions: state.assumptions,
    })
  } else {
    plans = await sampleWave({
      query,
      count: 1,
      start: 0,
      config,
      budget,
      runTool,
      supplements: sessionQuery.supplements,
      wave: ++waves,
      brief,
      assumptions: state.assumptions,
    })
    const asked = collectQuestions(plans)
    if (!asked.questions.length && plans[0] && plans[0].status !== 'failed') {
      const firstGround = checkGrounding(plans[0].plan, evidenceText(plans[0].notes))
      const safety = await safetyOnly({ query, plan: plans[0], timeoutMs: config.llmTimeoutMs, temperature: config.tauJudge })
      const trigger = String(plans[0].plan || '').includes('信息不足') || safety < config.thetaB || firstGround.G === 0
      if (trigger && waves < config.waveCap) {
        const rest = await sampleWave({
          query,
          count: config.sampleCount - 1,
          start: 1,
          config,
          budget,
          runTool,
          supplements: sessionQuery.supplements,
          wave: ++waves,
          brief,
          assumptions: state.assumptions,
        })
        plans = plans.concat(rest)
      }
    }
  }

  if (plans.every((plan) => plan.errorCode === 'NO_API_KEY')) {
    const error = new Error(plans[0].error || '未配置 API Key')
    error.code = 'NO_API_KEY'
    throw error
  }

  const asked = collectQuestions(plans)
  const finished = plans.filter((plan) => plan.status === 'done' && plan.plan && !isFailedPlan(plan))
  const needAsk = Boolean(asked.questions.length || plans.some((plan) => plan.supervisor?.missing?.length))
  // 只要有一路写成方案就进入评分；追问附在「待确认问题」。只有谁都没写完才整轮停在补充。
  if (needAsk && finished.length === 0) {
    const questions = asked.questions.length ? asked.questions : questionsFor(query).questions
    return {
      plans,
      asked,
      next: 'need_info',
      need: {
        query,
        facts,
        complexity,
        gap: { missing: questions.map((item) => item.id), questions, fields: questionsFor(query).fields },
        plans,
        deferred: asked.deferred,
        config,
        started,
        origin: sessionQuery.origin,
        supplements: sessionQuery.supplements,
        askedCounts: sessionQuery.askedCounts || {},
      },
    }
  }
  return { plans, asked, next: 'verify' }
}

async function verifyNode(state) {
  const { query, plans, asked, facts, complexity, config, started, brief } = state
  const finished = plans.filter((plan) => plan.status === 'done' && plan.plan && !isFailedPlan(plan))
  const judged = await verifyPlans({
    query,
    plans: finished.length ? finished : plans,
    reportPlans: plans,
    facts,
    config,
    brief,
  })
  const pendingQuestions = pendingLines(state.gatePending, asked?.questions)
  const pending = pendingQuestions.length
    ? `\n\n### 待确认问题\n${pendingQuestions.map((text, index) => `${index + 1}. ${text}`).join('\n')}`
    : ''
  const assumptionLine = (state.assumptions || []).length
    ? `（按假设作答：${state.assumptions.join('；')}）\n\n`
    : ''
  const winnerPlan = plans.find((plan) => plan.id === judged.winner?.id)
  const winnerNotes = (winnerPlan?.notes || []).map((note) => note.observation).join('\n')
  const banner = winnerPlan && !hasCaseEvidence(winnerNotes) ? `${NO_CASE_BANNER}\n\n` : ''
  const answer = `${assumptionLine}（${complexity.level === 'boundary' ? '边界题' : '复杂故障'}，只交付综合分选出的一份：${complexity.reason}）\n\n${banner}${judged.answer}${pending}`
  const result = pack({
    route: judged.winner ? 'complex' : 'no_plan',
    answer,
    complexity,
    facts,
    assumptions: state.assumptions || [],
    pendingQuestions,
    brief: brief || null,
    rubric: judged.rubric || buildRubric(facts, brief),
    plans: plans.map(publicPlanSafe),
    judge: judged.judge,
    accuracy: judged.accuracy,
    rejected: judged.rejected,
    flow: flowFor(facts, complexity, plans, judged),
    config,
    started,
    missing: [],
    questions: [],
    deferred: [],
    session: null,
  })
  return { result }
}

function pendingLines(gatePending, laneQuestions) {
  const fromGate = (gatePending || []).map((item) => String(item.text || item || '').trim()).filter(Boolean)
  const fromLanes = (laneQuestions || []).map((item) => String(item.text || '').trim()).filter(Boolean)
  const seen = new Set(fromGate)
  return [...fromGate, ...fromLanes.filter((text) => !seen.has(text))]
}

function publicPlanSafe(plan) {
  return {
    id: plan.id,
    title: plan.title,
    status: plan.status,
    stepCount: plan.stepCount,
    plan: plan.plan,
    error: plan.error,
    trace: plan.trace,
    stopReason: plan.stopReason || '',
    questions: plan.questions || [],
    briefDeviation: plan.briefDeviation || '',
    unsupported: plan.ground?.unsupported || [],
    supervisor: plan.supervisor
      ? {
          disagree: Boolean(plan.supervisor.disagree),
          unavailable: Boolean(plan.supervisor.unavailable),
          isolation_noted: Boolean(plan.supervisor.isolation_noted),
          note: plan.supervisor.note || '',
        }
      : null,
  }
}

export const diagnosisGraph = new StateGraph(DiagnosisState)
  .addNode('intake', intake)
  .addNode('simple', simpleNode)
  .addNode('need_info', needInfoNode)
  .addNode('classify', classifyNode)
  .addNode('main_brief', briefNode)
  .addNode('sample', sampleNode)
  .addNode('verify', verifyNode)
  .addEdge(START, 'intake')
  .addConditionalEdges('intake', (state) => state.next, ['simple', 'need_info', 'classify', 'main_brief'])
  .addConditionalEdges('classify', (state) => state.next, ['simple', 'main_brief'])
  .addConditionalEdges('main_brief', (state) => state.next, ['sample'])
  .addConditionalEdges('sample', (state) => state.next, ['need_info', 'verify'])
  .addEdge('simple', END)
  .addEdge('need_info', END)
  .addEdge('verify', END)
  .compile()

export async function runSama2(options = {}) {
  const output = await diagnosisGraph.invoke({ options, started: Date.now() }, { recursionLimit: 14 })
  return output.result
}

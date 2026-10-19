import { auditWinner, formatAudit } from './accuracyJudge.mjs'
import { renderNeedInfo } from './gaps.mjs'
import { checkGrounding, evidenceText, isFailedPlan } from './grounding.mjs'
import { waveDeadline } from './guard.mjs'
import { formatJudgement, judgePlans } from './judge.mjs'
import { logEvent } from './log.mjs'
import { answerSimple } from './mainAgent.mjs'
import { mapLimit } from './pool.mjs'
import { buildRoles } from './prompts.mjs'
import { runReactSub } from './reactLoop.mjs'
import { buildRubric } from './rubric.mjs'
import { createToolRunner } from './tools.mjs'

export async function finishSimple({ query, facts, hard, options, config, started }) {
  const simple = await answerSimple({ query, history: options.history, llmTimeoutMs: config.llmTimeoutMs })
  const ground = checkGrounding(simple.text, simple.evidence || '')
  const prefix = ground.pass ? '' : `这些扭矩、间隙或压力没有出现在本次资料观察中，不能当作事实：${ground.unsupported.join('、')}。\n\n`
  const flow = [
    factStep(facts),
    {
      stage: 'Main',
      title: '判定为简单问题',
      detail: `${sourceText(hard.source)}：${hard.reason}`,
      next: '一次回答，并核对扭矩、间隙、压力',
    },
    {
      stage: 'Main',
      title: '检索后一次生成',
      detail: ground.pass ? '出处核对通过。' : '出处核对没有通过，数字不能当作事实。',
      steps: simple.steps,
    },
  ]
  return pack({
    route: 'simple',
    answer: `（简单问题，直接答复：${hard.reason}）\n\n${prefix}${simple.text}`,
    complexity: hard,
    facts,
    rubric: null,
    plans: [],
    judge: null,
    accuracy: null,
    rejected: ground.pass ? [] : [{ id: 'simple', title: '简单答复', unsupported: ground.unsupported }],
    flow,
    config,
    started,
    missing: [],
    questions: [],
    deferred: [],
    session: null,
  })
}

export function finishNeedInfo({ query, facts, complexity, gap, plans, deferred = [], config, started, origin, supplements }) {
  const answer = renderNeedInfo({ fields: { ...gap.fields, phenomena: facts.phenomena, load: { value: facts.load }, thermal: { value: facts.thermal } }, questions: gap.questions })
  const keptSupplements = (supplements || []).filter((item) => item.text && item.text !== origin)
  return pack({
    route: 'need_info',
    answer,
    complexity,
    facts,
    rubric: null,
    plans: (plans || []).map(publicPlan),
    judge: null,
    accuracy: null,
    rejected: [],
    flow: [
      factStep(facts),
      {
        stage: 'Main',
        title: '条件不足',
        detail: `还缺：${gap.missing.join('、') || '中途提问'}`,
        next: '本轮不检索、不采样、不交付维修步骤',
      },
    ],
    config,
    started,
    missing: gap.missing,
    questions: gap.questions,
    deferred,
    session: { origin: origin || query, pending: gap.missing, supplements: keptSupplements },
  })
}

export async function sampleWave({ query, count, start, config, budget, runTool, supplements, wave }) {
  if (wave > config.waveCap) {
    return [blockedWave(start)]
  }
  const roles = buildRoles(count, { start, allowWeb: config.allowWeb })
  const startedAt = Date.now()
  const deadline = waveDeadline(startedAt, config.subTimeoutMs, count, config.staggerMs)
  return mapLimit(roles, config.concurrency, async (role, index) => {
    if (index > 0) await wait(index * config.staggerMs)
    return runReactSub({
      role,
      query,
      runTool,
      maxStep: config.maxStep,
      timeoutMs: config.subTimeoutMs,
      llmTimeoutMs: config.llmTimeoutMs,
      seed: config.seedBase + role.index,
      tauProp: config.tauProp,
      tauFinal: config.tauFinal,
      toolLimit: config.toolLimit,
      obsPrefix: config.obsPrefix,
      toolTimeoutMs: config.toolTimeoutMs,
      budget,
      waveDeadline: deadline,
      supplements,
      mtkbUrl: config.mtkbUrl,
    })
  })
}

function blockedWave(start) {
  return {
    id: `sub${start}`,
    title: `第${start + 1}路`,
    index: start,
    status: 'done',
    stepCount: 0,
    plan: '方案生成失败\n已超过允许的采样波次',
    error: 'request_waves',
    errorCode: 'REQUEST_WAVES',
    trace: [{ step: 0, thought: '第三波不再启动。', reason: 'request_waves', final: true }],
    notes: [],
    questions: [],
    stopReason: 'request_waves',
  }
}

export async function verifyPlans({ query, plans, reportPlans, facts, config }) {
  const rejected = []
  const survivors = []
  for (const plan of plans) {
    if (isFailedPlan(plan) || plan.status === 'failed') continue
    const ground = checkGrounding(plan.plan, evidenceText(plan.notes))
    plan.ground = ground
    if (!ground.pass || plan.status !== 'done') {
      rejected.push({ id: plan.id, title: plan.title, unsupported: ground.unsupported })
      continue
    }
    survivors.push(plan)
  }
  if (!survivors.length) {
    return {
      winner: null,
      judge: { ok: false, winner: null, ranked: [], note: '没有可交付方案' },
      accuracy: null,
      rejected,
      answer: formatJudgement(plans, { winner: null, ranked: [], note: '' }, rejected),
    }
  }
  const judgement = await judgePlans({
    query,
    rubric: buildRubric(facts),
    plans: survivors,
    timeoutMs: config.llmTimeoutMs,
  })
  const winner = judgement.winner ? survivors.find((plan) => plan.id === judgement.winner.id) : null
  const accuracy = winner
    ? await auditWinner({ query, plan: winner, timeoutMs: config.llmTimeoutMs })
    : null
  if (accuracy) accuracy.bestId = winner.id
  const answer = `${formatJudgement(reportPlans || plans, judgement, rejected)}${winner ? formatAudit(accuracy) : ''}`
  return { winner, judge: judgement, accuracy, rejected, answer }
}

export function flowFor(facts, complexity, plans, judged) {
  return [
    factStep(facts),
    {
      stage: 'Main',
      title: complexity.level === 'boundary' ? '判定为边界问题' : '判定为复杂问题',
      detail: `${sourceText(complexity.source)}：${complexity.reason}`,
      next: complexity.level === 'boundary' ? '先采样一路，必要时再补满' : '直接采样满 N 路',
    },
    ...plans.map((plan) => ({
      stage: plan.id,
      title: plan.title,
      detail: `${plan.status}，共 ${plan.stepCount} 轮${plan.stopReason ? `，${plan.stopReason}` : ''}`,
      next: tracePath(plan.trace),
    })),
    {
      stage: 'Judge',
      title: '加权评判',
      detail: judged.judge?.winner
        ? `中选 ${judged.judge.winner.title}，加权 ${judged.judge.winner.total}/10。`
        : (judged.judge?.note || '没有可交付方案'),
      next: '准确性只审计这一份，不改名次',
    },
    {
      stage: '审计',
      title: '准确性与可信度',
      detail: judged.accuracy?.accuracy != null
        ? `${judged.accuracy.title}：准确性 ${judged.accuracy.accuracy}/10，可信度 ${judged.accuracy.credibility}/10。`
        : (judged.accuracy?.note || '没有审计'),
    },
  ]
}

function factStep(facts) {
  const phenomena = (facts?.phenomena || []).join('、') || '未提取到现象'
  const machine = facts?.machine || '未识别设备'
  const load = facts?.load || '未识别空载或磨削'
  const thermal = facts?.thermal || '未识别冷机或热机'
  return {
    stage: 'Main',
    title: '提取故障信息',
    detail: `现象：${phenomena}。设备：${machine}。工况：${load}，${thermal}。`,
  }
}

function sourceText(source) {
  if (source === 'hard') return '硬规则'
  if (source === 'llm') return '分类模型'
  if (source === 'force') return '强制多路'
  if (source === 'fallback') return '分类失败后按复杂问题处理'
  return source || '未知来源'
}

function tracePath(trace) {
  const steps = Array.isArray(trace) ? trace : []
  if (!steps.length) return '没有留下步骤'
  return steps.map((step) => {
    if (step.reason && step.reason !== 'final') return `第${step.step}步 ${step.reason}`
    if (step.tool) return `第${step.step}步思考后调用 ${step.tool}`
    if (step.final) return `第${step.step}步给出方案`
    return `第${step.step}步收束`
  }).join(' → ')
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function publicPlan(plan) {
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

export function pack(result) {
  logEvent('finish', { route: result.route, ms: Date.now() - result.started, level: result.complexity?.level })
  return {
    content: result.answer,
    answer: result.answer,
    route: result.route,
    complexity: result.complexity,
    facts: result.facts,
    rubric: result.rubric,
    plans: result.plans,
    judge: result.judge
      ? {
          winnerId: result.judge.winner?.id || '',
          total: result.judge.winner?.total ?? null,
          ranked: result.judge.ranked || [],
          note: result.judge.note || '',
        }
      : null,
    accuracy: result.accuracy
      ? {
          bestId: result.accuracy.bestId || result.judge?.winner?.id || '',
          title: result.accuracy.title || '',
          accuracy: result.accuracy.accuracy ?? null,
          credibility: result.accuracy.credibility ?? null,
          reason: result.accuracy.reason || '',
          ranked: result.accuracy.ranked || [],
          note: result.accuracy.note || '',
        }
      : null,
    rejected: result.rejected || [],
    missing: result.missing || [],
    questions: result.questions || [],
    deferred: result.deferred || [],
    session: result.session || null,
    flow: result.flow || [],
    meta: {
      framework: 'langchain',
      graph: 'langgraph',
      forceMultiAgent: result.config.forceMultiAgent,
      maxStep: result.config.maxStep,
      concurrency: result.config.concurrency,
      allowWeb: result.config.allowWeb,
      elapsedMs: Date.now() - result.started,
    },
  }
}

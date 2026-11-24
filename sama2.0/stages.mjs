import { auditWinner, formatAudit } from './accuracyJudge.mjs'
import { buildBrief, formatBriefForLane } from './brief.mjs'
import { decorateTree } from './evidence.mjs'
import { bumpAskedCounts, renderNeedInfo } from './gaps.mjs'
import { checkGrounding, evidenceText, hasCaseEvidence, isFailedPlan, NO_CASE_BANNER } from './grounding.mjs'
import { waveDeadline } from './guard.mjs'
import { formatJudgement, judgePlans } from './judge.mjs'
import { logEvent } from './log.mjs'
import { answerSimple } from './mainAgent.mjs'
import { mapLimit } from './pool.mjs'
import { buildRoles } from './prompts.mjs'
import { buildLaneEntries, laneSearchHint, laneTemperature, runSqliteTree } from './retrieval-tree.mjs'
import { lookupStructured, alarmStatus } from './sama-sqlite/library.mjs'
import { runReactSub } from './reactLoop.mjs'
import { buildRubric } from './rubric.mjs'
import { loadLlmSettings } from './settings.mjs'
import { createToolRunner } from './tools.mjs'

export async function finishSimple({ query, facts, hard, options, config, started }) {
  const english = config.language === 'en'
  const simple = await answerSimple({ query, history: options.history, llmTimeoutMs: config.llmTimeoutMs, allowWeb: config.allowWeb, webAuto: config.webAuto, language: config.language })
  const ground = checkGrounding(simple.text, `${simple.evidence || ''}\n用户原文：\n${query || ''}`)
  const prefix = ground.pass ? '' : english
    ? `These torque, clearance or pressure values do not appear in the evidence and cannot be stated as facts: ${ground.unsupported.join(', ')}.\n\n`
    : `这些扭矩、间隙或压力没有出现在本次资料观察中，不能当作事实：${ground.unsupported.join('、')}。\n\n`
  const noCase = english
    ? 'No matching local machine case was found. Use the nearest documents only to choose one main direction to verify; do not expand into a generic grinder checklist.'
    : NO_CASE_BANNER
  const banner = hasCaseEvidence(simple.evidence) ? '' : `${noCase}\n\n`
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
    answer: `（简单问题，直接答复：${hard.reason}）\n\n${banner}${prefix}${simple.text}`,
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

export function finishNeedInfo({ query, facts, complexity, gap, plans, deferred = [], config, started, origin, supplements, askedCounts }) {
  const answer = renderNeedInfo({ fields: { ...gap.fields, phenomena: facts.phenomena, load: { value: facts.load }, thermal: { value: facts.thermal } }, questions: gap.questions }, config.language)
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
    session: {
      origin: origin || query,
      pending: gap.missing,
      supplements: keptSupplements,
      askedCounts: bumpAskedCounts(askedCounts, gap.missing),
    },
  })
}

export async function sampleWave({ query, count, start, config, budget, runTool, supplements, wave, brief, assumptions, facts, complexity }) {
  if (wave > config.waveCap) {
    return { plans: [blockedWave(start)], brief: brief || null }
  }
  // 用户已经补充过一轮后，不再提供 ask_user，避免反复追问进不了评分。
  const allowAskUser = !(Array.isArray(supplements) && supplements.length)
  const laneEntries = buildLaneEntries(query, {
    count,
    start,
    seedBase: config.seedBase,
    temps: config.laneTemps,
    entryMode: config.treeEntryMode,
    priorBeta: config.treePriorBeta,
    mmrLambda: config.treeMmrLambda,
    retry: config.treeEntryRetry,
  })
  const baseRoles = buildRoles(count, { start, allowWeb: config.allowWeb, allowAskUser, language: config.language })
    .map((role, index) => applyLaneSearch(role, laneEntries[index]?.entryQuery))
    .map((role) => applyAssumptions(role, assumptions))
  // 报警号/案例号先做确定性查表，结果注入每一路，避免“某一路没查到就整题答偏”。
  const structured = lookupStructured(query)
  const alarm = alarmStatus(query)
  const alarmDirective = alarm.status === 'missing'
    ? `【强制约束】报警号 ${alarm.code} 在本库报警表中不存在：只能说明“查不到该报警号的条目”，并给通用排查方向；禁止编造或猜测该报警号的含义、原因或参数。`
    : ''
  const injected = [alarmDirective, structured].filter(Boolean).join('\n\n')
  const structuredGrades = (text) => [...String(text || '').matchAll(/id: sqlite_fragment:(\d+)/g)]
    .map((match) => ({ id: `sqlite_fragment:${match[1]}`, grade: 'SUPPORT' }))
  const trees = await mapLimit(baseRoles, config.concurrency, async (role, index) => {
    if (!config.treeEnabled) return injected ? { text: injected, query, grades: structuredGrades(injected), records: [] } : null
    const entry = laneEntries[index] || { entryQuery: query, tau: laneTemperature(config, role.index), entryMode: config.treeEntryMode }
    const raw = await runSqliteTree({
      origin: query,
      firstQuery: entry.entryQuery,
      beamK: config.treeBeamK,
      topK: config.treeTopK || config.treeBeamK,
      hops: config.treeHops,
      gamma: config.treeGamma,
      hopCost: config.treeHopCost,
      alpha: config.treeAlpha,
      retBudget: config.treeRetBudget,
      hopFuse: config.treeHopFuse,
      tauLane: entry.tau ?? laneTemperature(config, role.index),
      entryMode: entry.entryMode || config.treeEntryMode,
      embedMode: config.treeEmbed,
    }).catch(() => null)
    if (!raw) return injected ? { text: injected, query, grades: structuredGrades(injected), records: [] } : null
    const decorated = decorateTree(raw, { origin: query, config })
    if (injected) {
      decorated.text = `${injected}\n\n${decorated.text || ''}`
      decorated.grades = [...structuredGrades(injected), ...(decorated.grades || [])]
    }
    return decorated
  })
  let usedBrief = brief || null
  if (config.briefEnabled) {
    const evidence = trees.map((tree) => tree?.text || '').filter(Boolean).join('\n\n')
    usedBrief = await buildBrief({
      query,
      facts,
      complexity,
      evidence,
      timeoutMs: config.llmTimeoutMs,
      language: config.language,
    })
    logEvent('brief', {
      ok: Boolean(usedBrief?.ok),
      hypotheses: usedBrief?.hypotheses?.length || 0,
      mustCheck: usedBrief?.mustCheck?.length || 0,
      source: usedBrief?.source || '',
    })
  }
  const roles = baseRoles.map((role) => applyBriefToRole(role, usedBrief))
  const startedAt = Date.now()
  const deadline = waveDeadline(startedAt, config.subTimeoutMs, count, config.staggerMs)
  const plans = await mapLimit(roles, config.concurrency, async (role, index) => {
    if (index > 0) await wait(index * config.staggerMs)
    const entry = laneEntries[index] || { entryQuery: query, tau: laneTemperature(config, role.index), entryMode: config.treeEntryMode }
    const tauProp = entry.tau ?? laneTemperature(config, role.index)
    return runReactSub({
      role,
      query,
      runTool,
      maxStep: config.maxStep,
      timeoutMs: config.subTimeoutMs,
      llmTimeoutMs: config.llmTimeoutMs,
      seed: entry.seed ?? (config.seedBase + role.index),
      tauProp,
      tauFinal: config.tauFinal,
      toolLimit: config.toolLimit,
      obsPrefix: config.obsPrefix,
      toolTimeoutMs: config.toolTimeoutMs,
      budget,
      waveDeadline: deadline,
      supplements,
      allowIncomplete: Boolean(assumptions?.length),
      treeSearch: trees[index] || (injected ? { text: injected, query, grades: structuredGrades(injected), records: [] } : null),
      mtkbUrl: config.mtkbUrl,
    })
  })
  return { plans, brief: usedBrief }
}

function applyLaneSearch(role, firstQuery) {
  if (!firstQuery) return role
  return { ...role, system: `${role.system}\n${laneSearchHint(role.index, firstQuery)}` }
}

function applyBriefToRole(role, brief) {
  if (!brief?.ok) return role
  const appendix = formatBriefForLane(brief)
  const counter = role.index === 4
    ? '\n你的职责是挑战上面的分析，优先找反例与遗漏，不要顺着它写。'
    : ''
  return { ...role, system: `${role.system}\n\n${appendix}${counter}` }
}

function applyAssumptions(role, assumptions) {
  if (!assumptions?.length) return role
  return {
    ...role,
    system: `${role.system}\n作答假设（方案里要保留，不能写成用户已经测量过的事实）：${assumptions.join('；')}`,
  }
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

export async function verifyPlans({ query, plans, reportPlans, facts, config, brief }) {
  const rejected = []
  const survivors = []
  for (const plan of plans) {
    if (isFailedPlan(plan) || plan.status === 'failed') continue
    // 用户原文里的读数算「用户提供」证据；编造的数字仍因不在原文与观察里而失败。
    const ground = checkGrounding(plan.plan, `${evidenceText(plan.notes)}\n用户原文：\n${query || ''}`)
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
      judge: { ok: false, winner: null, ranked: [], note: config.language === 'en' ? 'No deliverable plan' : '没有可交付方案' },
      accuracy: null,
      rejected,
      answer: formatJudgement(plans, { winner: null, ranked: [], note: '' }, rejected, config.language),
    }
  }
  const rubric = buildRubric(facts, brief)
  const judgement = await judgePlans({
    query,
    rubric,
    plans: survivors,
    timeoutMs: config.llmTimeoutMs,
    temperature: config.tauJudge,
    language: config.language,
  })
  const winner = judgement.winner ? survivors.find((plan) => plan.id === judgement.winner.id) : null
  const accuracy = winner
    ? await auditWinner({ query, plan: winner, timeoutMs: config.llmTimeoutMs, temperature: config.tauJudge, language: config.language })
    : null
  if (accuracy) accuracy.bestId = winner.id
  const answer = `${formatJudgement(reportPlans || plans, judgement, rejected, config.language)}${winner ? formatAudit(accuracy, config.language) : ''}`
  return { winner, judge: judgement, accuracy, rejected, answer, rubric }
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
        ? `第一名 ${judged.judge.winner.title}（${judged.judge.winner.total}/10）${judged.judge.ranked?.[1] ? `；第二名 ${judged.judge.ranked[1].title}（${judged.judge.ranked[1].total}/10）` : ''}。`
        : (judged.judge?.note || '没有可交付方案'),
      next: '交付前两名供选择；准确性只审计第一名，不改名次',
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
    briefDeviation: plan.briefDeviation || '',
    direction: plan.direction || null,
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
  const llm = loadLlmSettings()
  logEvent('finish', { route: result.route, ms: Date.now() - result.started, level: result.complexity?.level, model: llm.model, judgeModel: llm.judgeModel })
  return {
    content: result.answer,
    answer: result.answer,
    route: result.route,
    complexity: result.complexity,
    facts: result.facts,
    brief: result.brief || null,
    rubric: result.rubric,
    plans: result.plans,
    judge: result.judge
      ? {
          winnerId: result.judge.winner?.id || '',
          runnerUpId: result.judge.ranked?.[1]?.id || '',
          total: result.judge.winner?.total ?? null,
          runnerUpTotal: result.judge.ranked?.[1]?.total ?? null,
          ranked: result.judge.ranked || [],
          note: result.judge.note || '',
          model: result.judge.model || '',
        }
      : null,
    accuracy: result.accuracy
      ? {
          bestId: result.accuracy.bestId || result.judge?.winner?.id || '',
          title: result.accuracy.title || '',
          accuracy: result.accuracy.accuracy ?? null,
          credibility: result.accuracy.credibility ?? null,
          layers: result.accuracy.layers || null,
          reason: result.accuracy.reason || '',
          ranked: result.accuracy.ranked || [],
          note: result.accuracy.note || '',
          model: result.accuracy.model || '',
        }
      : null,
    rejected: result.rejected || [],
    missing: result.missing || [],
    assumptions: result.assumptions || [],
    pendingQuestions: result.pendingQuestions || [],
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
      model: llm.model,
      judgeModel: llm.judgeModel,
    },
  }
}


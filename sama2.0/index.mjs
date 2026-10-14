/**
 * SAMA 2.0 磨床维修编排。本目录自包含，不引用目录外的旧代码。
 *
 * 用户问题 → Main 提取事实并做复杂度判断（硬规则优先，边界才调分类模型）
 *   simple：Main 直接答复，不启动 5 个 Sub
 *   complex：同一完整问题并行交给 5 个隔离 Sub；每个 Sub 自己做 ReAct（默认最多 8 轮，硬上限 50）
 *           全部结束后由 Judge 按加权标准选最优方案，准确性专评另给准确性最高的一套和可信度
 *
 * 模型：settings.json 或环境变量 SAMA2_API_KEY / SAMA2_BASE_URL / SAMA2_MODEL
 * 资料：knowledge 目录
 * 调试：forceMultiAgent 或 SAMA2_FORCE_MULTI=1
 * 轮次：maxStep 或 SAMA2_MAX_STEP（调试默认 8，上线再调到 50）
 *
 * 启动：node index.mjs "外圆磨床主轴发热、震动大"
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { judgeAccuracy, formatAccuracy } from './accuracyJudge.mjs'
import { resolveConfig } from './config.mjs'
import { extractFaultFacts } from './facts.mjs'
import { judgePlans, formatJudgement } from './judge.mjs'
import { logEvent } from './log.mjs'
import { answerSimple, classifyComplexity } from './mainAgent.mjs'
import { mapLimit } from './pool.mjs'
import { SUB_ROLES } from './prompts.mjs'
import { runReactSub } from './reactLoop.mjs'
import { buildRubric } from './rubric.mjs'
import { createToolRunner } from './tools.mjs'

export async function runSama2(options = {}) {
  const started = Date.now()
  const query = String(options.userText || options.query || '').trim()
  if (!query) {
    const error = new Error('请输入磨床故障或问题')
    error.code = 'EMPTY_QUERY'
    throw error
  }

  const config = resolveConfig(options)
  const facts = extractFaultFacts(query)
  logEvent('start', { chars: query.length, force: config.forceMultiAgent, maxStep: config.maxStep })

  let complexity
  if (config.forceMultiAgent) {
    complexity = { level: 'complex', reason: 'force_multi_agent 已开启，跳过复杂度判断', source: 'force' }
    logEvent('complexity', complexity)
  } else {
    complexity = await classifyComplexity(query, { llmTimeoutMs: config.llmTimeoutMs })
  }

  if (complexity.level === 'simple') {
    const simple = await answerSimple({
      query,
      history: options.history,
      llmTimeoutMs: config.llmTimeoutMs,
    })
    const flow = [
      factStep(facts),
      {
        stage: 'Main',
        title: '判定为简单问题',
        detail: `${sourceText(complexity.source)}：${complexity.reason}`,
        next: 'Main 直接答复，不启动五个 Sub，也不进入 Judge',
      },
      {
        stage: 'Main',
        title: '检索后一次生成',
        detail: '先查本地资料和测点模板，再写答复。这一路没有多轮思考。',
        steps: simple.steps,
      },
    ]
    return pack({
      route: 'simple',
      answer: `（简单问题，直接答复：${complexity.reason}）\n\n${simple.text}`,
      complexity,
      facts,
      rubric: null,
      plans: [],
      judge: null,
      accuracy: null,
      flow,
      config,
      started,
    })
  }

  const rubric = buildRubric(facts)
  const fullQuery = composeQuery(query, options.history)
  const runTool = createToolRunner()
  const plans = await mapLimit(SUB_ROLES, config.concurrency, async (role, index) => {
    if (index > 0) await wait(index * 400)
    return runReactSub({
      role,
      query: fullQuery,
      runTool: (name, args) => {
        if (!role.tools.includes(name)) return `当前角色不能使用 ${name}。`
        return runTool(name, args)
      },
      maxStep: config.maxStep,
      timeoutMs: config.subTimeoutMs,
      llmTimeoutMs: config.llmTimeoutMs,
    })
  })

  if (plans.every((plan) => plan.errorCode === 'NO_API_KEY')) {
    const error = new Error(plans[0].error || '未配置 API Key')
    error.code = 'NO_API_KEY'
    throw error
  }

  const [judgement, accuracy] = await Promise.all([
    judgePlans({
      query: fullQuery,
      rubric,
      plans,
      timeoutMs: config.llmTimeoutMs,
    }),
    judgeAccuracy({
      query: fullQuery,
      plans,
      timeoutMs: config.llmTimeoutMs,
    }),
  ])
  const answer = `（复杂故障，五路方案评判后给出：${complexity.reason}）\n\n${formatJudgement(plans, judgement)}${formatAccuracy(accuracy, judgement)}`
  const published = plans.map(publicPlan)
  const flow = [
    factStep(facts),
    {
      stage: 'Main',
      title: '判定为复杂问题',
      detail: `${sourceText(complexity.source)}：${complexity.reason}`,
      next: '同一完整原题并行交给五个 Sub，彼此看不到对方',
    },
    ...published.map((plan) => ({
      stage: plan.id,
      title: plan.title,
      detail: `${plan.status}，共 ${plan.stepCount} 轮`,
      next: tracePath(plan.trace),
    })),
    {
      stage: 'Judge',
      title: '加权评判',
      detail: judgement?.winner
        ? `中选 ${judgement.winner.title}，加权 ${judgement.winner.total}/10。${judgement.note || ''}`
        : (judgement?.note || '没有选出方案'),
      next: '与准确性专评同时进行，互不改分',
    },
    {
      stage: '准确性专评',
      title: '准确性与可信度',
      detail: accuracy?.best
        ? `${accuracy.best.title}：准确性 ${accuracy.best.accuracy}/10，可信度 ${accuracy.best.credibility}/10。${accuracy.best.reason || ''}`
        : (accuracy?.note || '准确性专评没有完成'),
    },
    {
      stage: '输出',
      title: '返回用户',
      detail: '正文采用加权中选方案，并附上准确性专评。思考过程和流程走向只在作者开关里显示。',
    },
  ]
  return pack({
    route: 'complex',
    answer,
    complexity,
    facts,
    rubric,
    plans: published,
    judge: judgement,
    accuracy,
    flow,
    config,
    started,
  })
}

function factStep(facts) {
  const phenomena = (facts?.phenomena || []).join('、') || '未提取到现象'
  const machine = facts?.machine || '未识别设备'
  const constraints = (facts?.constraints || []).join('；') || '无额外约束'
  return {
    stage: 'Main',
    title: '提取故障信息',
    detail: `现象：${phenomena}。设备：${machine}。约束：${constraints}。`,
  }
}

function sourceText(source) {
  if (source === 'hard') return '硬规则'
  if (source === 'llm') return '分类模型'
  if (source === 'force') return '强制五路'
  if (source === 'fallback') return '分类失败后按复杂问题处理'
  return source || '未知来源'
}

function tracePath(trace) {
  const steps = Array.isArray(trace) ? trace : []
  if (!steps.length) return '没有留下步骤'
  return steps.map((step) => {
    if (step.tool) return `第${step.step}步思考后调用 ${step.tool}`
    if (step.final) return `第${step.step}步给出方案`
    return `第${step.step}步收束`
  }).join(' → ')
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function composeQuery(query, history) {
  const rows = Array.isArray(history) ? history.slice(-4) : []
  if (!rows.length) return query
  const prior = rows
    .map((item) => `${item.role === 'assistant' ? '助手' : '用户'}：${String(item.content || '').slice(0, 400)}`)
    .join('\n')
  return `${query}\n\n先前对话只作为现场约束，下面这一整题仍要独立完整求解，不要拆成子题：\n${prior}`
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
  }
}

function pack(result) {
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
          bestId: result.accuracy.best?.id || '',
          title: result.accuracy.best?.title || '',
          accuracy: result.accuracy.best?.accuracy ?? null,
          credibility: result.accuracy.best?.credibility ?? null,
          reason: result.accuracy.best?.reason || '',
          ranked: result.accuracy.ranked || [],
          note: result.accuracy.note || '',
        }
      : null,
    flow: result.flow || [],
    meta: {
      forceMultiAgent: result.config.forceMultiAgent,
      maxStep: result.config.maxStep,
      concurrency: result.config.concurrency,
      elapsedMs: Date.now() - result.started,
    },
  }
}

const selfPath = fileURLToPath(import.meta.url)
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entryPath === selfPath) {
  const query = process.argv.slice(2).join(' ').trim()
  if (!query) {
    console.error('用法：node index.mjs "磨床故障描述"')
    process.exit(1)
  }
  runSama2({ userText: query })
    .then((result) => {
      console.log(result.answer)
    })
    .catch((error) => {
      console.error(error?.message || error)
      process.exit(1)
    })
}

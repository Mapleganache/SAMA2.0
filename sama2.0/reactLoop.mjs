import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { parseAskUser } from './gaps.mjs'
import { actionKey, isDuplicate, samePrefix } from './guard.mjs'
import { clip, extractJson } from './json.mjs'
import { logEvent } from './log.mjs'
import { callText } from './llm.mjs'
import { thinkInstruction } from './prompts.mjs'
import { superviseMid } from './supervisor.mjs'

const FAILED = '方案生成失败'
const contexts = new Map()

const LaneState = Annotation.Root({
  runId: Annotation(),
  lane: Annotation(),
})

const laneGraph = new StateGraph(LaneState)
  .addNode('model', modelNode)
  .addNode('tools', toolsNode)
  .addNode('close', closeNode)
  .addEdge(START, 'model')
  .addConditionalEdges('model', afterModel, ['model', 'tools', 'close'])
  .addConditionalEdges('tools', afterTools, ['model', 'close'])
  .addEdge('close', END)
  .compile()

export async function runReactSub(options) {
  const started = Date.now()
  const pathDeadline = started + options.timeoutMs
  const deadline = options.waveDeadline ? Math.min(pathDeadline, options.waveDeadline) : pathDeadline
  const runId = `${options.role.id}:${started}:${Math.random().toString(16).slice(2)}`
  const lane = createLane(options)
  contexts.set(runId, { ...options, deadline })
  try {
    const output = await laneGraph.invoke(
      { runId, lane },
      { recursionLimit: (options.maxStep || 8) + (options.toolLimit || 4) + 8 },
    )
    return output.lane
  } finally {
    contexts.delete(runId)
  }
}

function createLane(options) {
  const lane = {
    id: options.role.id,
    title: options.role.title,
    index: options.role.index ?? 0,
    stepCount: 0,
    maxStep: options.maxStep,
    notes: [],
    trace: [],
    plan: '',
    status: 'running',
    error: '',
    errorCode: '',
    questions: [],
    stopReason: '',
    briefDeviation: '',
    supervisor: null,
    pendingTool: false,
    decision: null,
  }
  if (options.supplements?.length) {
    lane.notes.push({
      step: 0,
      tool: 'user-reply',
      args: {},
      observation: `user-reply\n${options.supplements.map((item) => String(item.text || '')).join('\n')}`,
      executed: false,
    })
  }
  if (options.treeSearch?.text) {
    const query = options.treeSearch.query || ''
    lane.notes.push({
      step: 0,
      tool: 'search_knowledge',
      args: { query },
      observation: `${lane.id}-tree\n${options.treeSearch.text}`,
      raw: clip(options.treeSearch.text, 3500),
      executed: true,
      key: actionKey('search_knowledge', { query }),
      obsId: `${lane.id}-tree`,
      thought: '本路按独立入口检索，再沿命中资料向外跳',
    })
    lane.trace.push({
      step: 0,
      thought: '本路按独立入口检索，再沿命中资料向外跳',
      tool: 'search_knowledge',
      args: { query },
      observation: clip(options.treeSearch.text, 800),
      final: false,
      reason: 'retrieval_tree',
    })
  }
  return lane
}

function afterModel(state) {
  if (state.lane.status !== 'running') return 'close'
  if (state.lane.pendingTool) return 'tools'
  return 'model'
}

function afterTools(state) {
  return state.lane.status === 'running' ? 'model' : 'close'
}

async function modelNode(state) {
  const ctx = contexts.get(state.runId)
  const lane = state.lane
  try {
    await modelStep(lane, ctx)
  } catch (error) {
    failLane(lane, error)
  }
  return { lane }
}

async function toolsNode(state) {
  const ctx = contexts.get(state.runId)
  const lane = state.lane
  try {
    await toolsStep(lane, ctx)
  } catch (error) {
    failLane(lane, error)
  }
  return { lane }
}

async function closeNode(state) {
  const ctx = contexts.get(state.runId)
  await closeLane(state.lane, ctx)
  return { lane: state.lane }
}

async function modelStep(lane, ctx) {
  lane.pendingTool = false
  const left = ctx.deadline - Date.now()
  if (left < 8000) {
    lane.stopReason = 'timeout'
    lane.trace.push({
      step: lane.stepCount,
      thought: '剩余时间不足，停止继续请求模型，改为整理已经拿到的观察。',
      tool: '',
      final: true,
      reason: 'timeout',
    })
    lane.plan = stitch(lane, '已到本路超时上限')
    lane.status = 'timeout'
    return
  }
  if (ctx.budget && !ctx.budget.claim()) {
    lane.stopReason = 'request_steps'
    lane.plan = await finishFromNotes(lane, ctx, Math.min(ctx.llmTimeoutMs, left), '整次请求的步数已经用完')
    lane.trace.push({
      step: lane.stepCount,
      thought: '整次请求的步数名额已经用完，不再开始新的一步。',
      tool: '',
      final: true,
      reason: 'request_steps',
    })
    lane.status = 'done'
    return
  }

  lane.stepCount += 1
  const executed = lane.notes.filter((note) => note.executed).length
  const stepCap = lane.stepCount >= ctx.maxStep
  const mustFinish = stepCap || executed >= (ctx.toolLimit ?? 4)
  const decision = await thinkOnce({
    role: ctx.role,
    query: ctx.query,
    state: lane,
    mustFinish,
    llmTimeoutMs: Math.min(ctx.llmTimeoutMs, left),
    temperature: mustFinish ? (ctx.tauFinal ?? 0.2) : (ctx.tauProp ?? 0.7),
    seed: ctx.seed,
    deadline: ctx.deadline,
  })
  const reason = mustFinish ? (stepCap ? 'step_cap' : 'tool_budget') : ''
  lane.trace.push({
    step: lane.stepCount,
    thought: decision.thought,
    tool: decision.tool || '',
    final: Boolean(decision.final) || mustFinish,
    reason,
  })
  logEvent('sub_step', {
    id: ctx.role.id,
    step: lane.stepCount,
    tool: decision.tool || '',
    finish: Boolean(decision.final) || mustFinish,
    domain: String(decision.args?.domain || '').slice(0, 40),
    subsystem: String(decision.args?.subsystem || '').slice(0, 40),
    query: String(decision.args?.query || '').replace(/\s+/g, ' ').slice(0, 50),
  })

  if (decision.invalid) {
    lane.trace[lane.trace.length - 1].final = false
    lane.trace[lane.trace.length - 1].reason = 'bad_json'
    lane.trace[lane.trace.length - 1].thought = decision.thought || '这一步不是一份方案，也不是一次可执行的工具调用。'
    return
  }

  if (mustFinish || decision.final || !decision.tool) {
    lane.stopReason = reason || (decision.final ? 'final' : 'no_tool')
    if (decision.briefDeviation) lane.briefDeviation = decision.briefDeviation
    if (decision.final) lane.plan = decision.final
    else if (mustFinish) {
      lane.plan = await finishFromNotes(lane, ctx, Math.min(ctx.llmTimeoutMs, left), stepCap ? '达到轮次上限' : '工具次数已满')
      lane.trace.push({
        step: lane.stepCount,
        thought: stepCap
          ? '这一步已经到轮次上限，模型没有交成稿。系统要求按已有观察整理方案，不再调用工具。'
          : '工具次数已满，系统要求按已有观察整理方案，不再调用工具。',
        tool: '',
        final: true,
        reason,
      })
    } else {
      lane.plan = decision.thought || '现有信息不足，未能形成方案。'
    }
    lane.status = 'done'
    return
  }

  if (decision.tool === 'ask_user') {
    const parsed = parseAskUser(decision.args)
    if (!parsed.ok) {
      remember(lane, decision, `参数无效：${parsed.reason}`, true)
      return
    }
    lane.questions = parsed.questions.map((item) => ({ ...item, step: lane.stepCount }))
    lane.status = 'need_info'
    lane.stopReason = 'ask_user'
    lane.plan = ''
    remember(lane, decision, `已向用户提问：${parsed.questions.map((item) => item.text).join('；')}`, true)
    return
  }

  if (isDuplicate(lane.notes, decision.tool, decision.args)) {
    lane.stopReason = 'repeat_args'
    remember(lane, decision, '此查询已做过，停止继续调用工具。', false)
    lane.trace[lane.trace.length - 1].reason = 'repeat_args'
    lane.plan = await finishFromNotes(lane, ctx, Math.min(ctx.llmTimeoutMs, left), '此查询已做过')
    lane.status = 'done'
    return
  }

  lane.decision = decision
  lane.pendingTool = true
}

async function toolsStep(lane, ctx) {
  const decision = lane.decision
  lane.pendingTool = false
  const left = ctx.deadline - Date.now()
  let raw = ''
  try {
    raw = await runWithTimeout(() => ctx.runTool(decision.tool, decision.args || {}), ctx.toolTimeoutMs)
  } catch (error) {
    if (error?.code !== 'TOOL_TIMEOUT') throw error
    lane.stopReason = 'tool_timeout'
    remember(lane, decision, '工具超时', true)
    lane.trace[lane.trace.length - 1].reason = 'tool_timeout'
    lane.plan = await finishFromNotes(lane, ctx, Math.min(ctx.llmTimeoutMs, left), '工具超时')
    lane.status = 'done'
    return
  }

  const previous = [...lane.notes].reverse().find((note) => note.executed)
  if (samePrefix(previous?.raw, clip(raw, 3500), ctx.obsPrefix ?? 200)) {
    lane.stopReason = 'repeat_obs'
    remember(lane, decision, raw, true)
    lane.trace[lane.trace.length - 1].reason = 'repeat_obs'
    lane.plan = await finishFromNotes(lane, ctx, Math.min(ctx.llmTimeoutMs, left), '观察与上一条开头相同')
    lane.status = 'done'
    return
  }
  remember(lane, decision, raw, true)
}

async function closeLane(lane, ctx) {
  if (!lane.plan && lane.status !== 'need_info') {
    lane.status = 'failed'
    lane.plan = FAILED
  }
  if (lane.status === 'timeout') lane.status = 'done'
  if (lane.status === 'done' && lane.plan && !String(lane.plan).startsWith(FAILED)) {
    lane.supervisor = await superviseMid({
      query: ctx.query,
      plan: lane.plan,
      notes: lane.notes,
      timeoutMs: Math.min(ctx.llmTimeoutMs, ctx.deadline - Date.now()),
      deadline: ctx.deadline,
      mtkbUrl: ctx.mtkbUrl,
    })
    if (lane.supervisor?.missing?.length && !ctx.allowIncomplete) {
      lane.status = 'need_info'
      lane.stopReason = lane.stopReason || 'missing_fields'
    }
  }
  lane.pendingTool = false
  lane.decision = null
  logEvent('sub_done', { id: lane.id, status: lane.status, steps: lane.stepCount, chars: lane.plan.length, reason: lane.stopReason })
}

function failLane(lane, error) {
  lane.status = 'failed'
  lane.error = error?.message || String(error)
  lane.errorCode = error?.code || ''
  lane.plan = `${FAILED}\n${lane.error}`
  lane.pendingTool = false
  logEvent('sub_failed', { id: lane.id, code: lane.errorCode, message: clip(lane.error, 300) })
}

function remember(state, decision, raw, executed) {
  const obsId = `${state.id}-step${state.stepCount}`
  const text = String(raw || '')
  const note = {
    step: state.stepCount,
    tool: decision.tool,
    args: decision.args || {},
    observation: `${obsId}\n${text}`,
    raw: clip(text, 3500),
    executed,
    key: actionKey(decision.tool, decision.args || {}),
    obsId,
    thought: decision.thought || '',
  }
  state.notes.push(note)
  const current = state.trace[state.trace.length - 1]
  if (current) {
    current.args = decision.args || {}
    current.observation = note.observation
    current.tool = decision.tool || current.tool
  }
}

async function thinkOnce({ role, query, state, mustFinish, llmTimeoutMs, temperature, seed, deadline }) {
  const transcript = state.notes
    .slice(-6)
    .map((note) => `第${note.step}步 ${note.tool} ${JSON.stringify(note.args)}\n观察：${clip(note.observation, 3500)}`)
    .join('\n\n')
  const response = await callText({
    system: thinkInstruction({ system: role.system, toolNames: role.tools, mustFinish }),
    user: `完整故障问题（不要拆开，独立求这一整题）：\n${query}\n\n已收集观察：\n${transcript || '（还没有）'}`,
    temperature,
    seed,
    deadline,
    timeoutMs: Math.max(8000, llmTimeoutMs),
    maxTokens: 4096,
  })
  return parseDecision(response.content, mustFinish)
}

function parseDecision(text, mustFinish) {
  const obj = extractJson(text)
  if (!obj) {
    const raw = String(text || '').trim()
    if (/"tool"\s*:/.test(raw)) {
      return { thought: '模型一次写了多段工具调用，这一步不能当成方案。', tool: '', final: '', invalid: true }
    }
    return { thought: '', final: raw, tool: '' }
  }
  const thought = String(obj.thought || '').trim()
  const finalText = String(obj.final || obj.answer || '').trim()
  const briefDeviation = String(obj.brief_deviation || obj.briefDeviation || '').trim()
  if (mustFinish) return { thought, final: finalText, tool: '', briefDeviation }
  if (finalText) return { thought, final: finalText, tool: '', briefDeviation }
  const tool = String(obj.tool || obj.action || '').trim()
  if (!tool || tool === 'none' || tool === 'null') return { thought, final: thought, tool: '', briefDeviation }
  const args = obj.args && typeof obj.args === 'object' ? obj.args : {}
  return { thought, tool, args, briefDeviation }
}

async function finishFromNotes(state, ctx, llmTimeoutMs, why) {
  try {
    const response = await callText({
      system: `${ctx.role.system}\n只输出最终维修方案 Markdown，不要 JSON，不要再要工具。`,
      user: `原因：${why}\n问题：${ctx.query}\n已有观察：\n${state.notes.map((note) => note.observation).join('\n---\n') || '无'}`,
      temperature: ctx.tauFinal ?? 0.2,
      seed: ctx.seed,
      deadline: ctx.deadline,
      timeoutMs: Math.min(Math.max(8000, llmTimeoutMs), 60000),
      maxTokens: 4096,
    })
    return response.content?.trim() || stitch(state, why)
  } catch (error) {
    return `${stitch(state, why)}\n\n整理时模型调用失败：${error?.message || error}`
  }
}

function stitch(state, why) {
  const body = state.notes.map((note, index) => `${index + 1}. ${note.tool}：${clip(note.observation, 500)}`).join('\n')
  return `（${why}，按下述已收集信息整理，未完成完整推理）\n${body || '没有收集到工具观察。'}`
}

function runWithTimeout(work, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error('工具超时')
      error.code = 'TOOL_TIMEOUT'
      reject(error)
    }, ms)
    Promise.resolve()
      .then(work)
      .then((value) => {
        clearTimeout(timer)
        resolve(value)
      })
      .catch((error) => {
        clearTimeout(timer)
        reject(error)
      })
  })
}

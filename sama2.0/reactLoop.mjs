import { clip, extractJson } from './json.mjs'
import { logEvent } from './log.mjs'
import { callText } from './llm.mjs'
import { thinkInstruction } from './prompts.mjs'

const FAILED = '方案生成失败'

export async function runReactSub({
  role,
  query,
  runTool,
  maxStep,
  timeoutMs,
  llmTimeoutMs,
}) {
  const started = Date.now()
  const deadline = started + timeoutMs
  const state = {
    id: role.id,
    title: role.title,
    stepCount: 0,
    maxStep,
    notes: [],
    trace: [],
    plan: '',
    status: 'running',
    error: '',
    errorCode: '',
  }

  try {
    while (state.status === 'running') {
      const left = deadline - Date.now()
      if (left < 8000) {
        state.status = 'timeout'
        state.trace.push({
          step: state.stepCount,
          thought: '剩余时间不足，停止继续请求模型，改为整理已经拿到的观察。',
          tool: '',
          final: true,
        })
        state.plan = stitch(state, '已到本路超时上限')
        break
      }
      state.stepCount += 1
      const mustFinish = state.stepCount >= maxStep
      const decision = await thinkOnce({ role, query, state, mustFinish, llmTimeoutMs: Math.min(llmTimeoutMs, left) })
      state.trace.push({ step: state.stepCount, thought: decision.thought, tool: decision.tool || '', final: Boolean(decision.final) })
      logEvent('sub_step', { id: role.id, step: state.stepCount, tool: decision.tool || '', finish: Boolean(decision.final) || mustFinish })

      if (mustFinish || decision.final) {
        state.status = mustFinish ? 'truncated' : 'done'
        if (decision.final) {
          state.plan = decision.final
        } else {
          state.plan = await finishFromNotes(state, role, query, Math.min(llmTimeoutMs, left), '达到轮次上限')
          state.trace.push({
            step: state.stepCount,
            thought: '这一步已经到轮次上限，模型没有交成稿。系统要求按已有观察整理方案，不再调用工具。',
            tool: '',
            final: true,
          })
        }
        break
      }
      if (!decision.tool) {
        state.status = 'done'
        state.plan = decision.final || decision.thought || '现有信息不足，未能形成方案。'
        break
      }
      const observation = clip(await runTool(decision.tool, decision.args || {}), 3500)
      state.notes.push({ step: state.stepCount, tool: decision.tool, args: decision.args || {}, observation })
      const current = state.trace[state.trace.length - 1]
      if (current) {
        current.args = decision.args || {}
        current.observation = observation
      }
    }
  } catch (error) {
    state.status = 'failed'
    state.error = error?.message || String(error)
    state.errorCode = error?.code || ''
    state.plan = `${FAILED}\n${state.error}`
    logEvent('sub_failed', { id: role.id, code: state.errorCode, message: clip(state.error, 300) })
  }

  if (!state.plan) {
    state.status = 'failed'
    state.plan = FAILED
  }
  if (state.status === 'truncated' || state.status === 'timeout') state.status = 'done'
  logEvent('sub_done', { id: role.id, status: state.status, steps: state.stepCount, chars: state.plan.length })
  return state
}

async function thinkOnce({ role, query, state, mustFinish, llmTimeoutMs }) {
  const transcript = state.notes
    .slice(-6)
    .map((note) => `第${note.step}步 ${note.tool} ${JSON.stringify(note.args)}\n观察：${note.observation}`)
    .join('\n\n')
  const response = await callText({
    system: thinkInstruction({ system: role.system, toolNames: role.tools, mustFinish }),
    user: `完整故障问题（不要拆开，独立求这一整题）：\n${query}\n\n已收集观察：\n${transcript || '（还没有）'}`,
    temperature: mustFinish ? 0.2 : 0.3,
    timeoutMs: Math.max(8000, llmTimeoutMs),
    maxTokens: 4096,
  })
  return parseDecision(response.content, mustFinish)
}

function parseDecision(text, mustFinish) {
  const obj = extractJson(text)
  if (!obj) {
    return { thought: '', final: String(text || '').trim(), tool: '' }
  }
  const thought = String(obj.thought || '').trim()
  const finalText = String(obj.final || obj.answer || '').trim()
  if (mustFinish) return { thought, final: finalText, tool: '' }
  if (finalText) return { thought, final: finalText, tool: '' }
  const tool = String(obj.tool || obj.action || '').trim()
  if (!tool || tool === 'none' || tool === 'null') return { thought, final: thought, tool: '' }
  const args = obj.args && typeof obj.args === 'object' ? obj.args : {}
  return { thought, tool, args }
}

async function finishFromNotes(state, role, query, llmTimeoutMs, why) {
  try {
    const response = await callText({
      system: `${role.system}\n只输出最终维修方案 Markdown，不要 JSON，不要再要工具。`,
      user: `原因：${why}\n问题：${query}\n已有观察：\n${state.notes.map((note) => note.observation).join('\n---\n') || '无'}`,
      timeoutMs: Math.min(llmTimeoutMs, 60000),
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

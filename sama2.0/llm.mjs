import { SystemMessage, HumanMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { loadLlmSettings } from './settings.mjs'

export async function callText({
  system,
  user,
  temperature = 0.2,
  timeoutMs = 90000,
  maxTokens = 4096,
  seed,
  deadline,
  purpose = 'generate',
}) {
  const run = () => complete({ system, user, temperature, timeoutMs, maxTokens, seed, purpose })
  try {
    return await run()
  } catch (error) {
    const text = String(error?.message || error)
    if (error?.status === 429 || /429|请求过快|rate/i.test(text)) {
      if (deadline && Date.now() >= deadline) throw error
      await delay(2000)
      if (deadline && Date.now() >= deadline) throw error
      return complete({ system, user, temperature, timeoutMs, maxTokens, seed, purpose })
    }
    throw error
  }
}

async function complete({ system, user, temperature, timeoutMs, maxTokens, seed, purpose }) {
  const settings = loadLlmSettings()
  if (!settings.apiKey) {
    const error = new Error('未配置 API Key。请在 sama2.0/settings.json 填写 apiKey，或设置环境变量 SAMA2_API_KEY。')
    error.code = 'NO_API_KEY'
    throw error
  }

  const modelName = purpose === 'judge' ? settings.judgeModel : settings.model
  const model = new ChatOpenAI({
    model: modelName,
    apiKey: settings.apiKey,
    temperature,
    maxTokens,
    timeout: timeoutMs,
    maxRetries: 0,
    modelKwargs: {
      ...(Number.isFinite(seed) ? { seed } : {}),
      ...(settings.effort ? { reasoning_effort: settings.effort } : {}),
    },
    configuration: {
      baseURL: settings.baseUrl,
      fetch: fetchKeepingReasoning,
    },
  })

  let response
  try {
    response = await model.invoke([
      new SystemMessage(String(system || '')),
      new HumanMessage(String(user || '')),
    ])
  } catch (error) {
    throw wrapModelError(error, timeoutMs)
  }

  const content = messageText(response)
  if (!content) {
    const error = new Error('模型未返回内容')
    error.code = 'EMPTY'
    throw error
  }
  return { content, model: modelName, purpose }
}

function messageText(response) {
  const content = response?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => (typeof part === 'string' ? part : part?.text || '')).join('')
  }
  return ''
}

async function fetchKeepingReasoning(url, init) {
  const response = await globalThis.fetch(url, init)
  const raw = await response.text()
  try {
    const data = JSON.parse(raw)
    const message = data?.choices?.[0]?.message
    if (message && !message.content && message.reasoning_content) message.content = message.reasoning_content
    return new Response(JSON.stringify(data), {
      status: response.status,
      statusText: response.statusText,
      headers: { 'content-type': 'application/json' },
    })
  } catch {
    return new Response(raw, {
      status: response.status,
      statusText: response.statusText,
      headers: { 'content-type': response.headers.get('content-type') || 'text/plain' },
    })
  }
}

function wrapModelError(error, timeoutMs) {
  const status = error?.status
  const message = String(error?.message || error)
  if (status === 429 || /429|rate/i.test(message)) {
    const again = new Error(message)
    again.status = 429
    throw again
  }
  if (error?.name === 'AbortError' || /timeout|timed out|abort/i.test(message)) {
    const timeout = new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`)
    timeout.code = 'TIMEOUT'
    throw timeout
  }
  if (status) {
    const api = new Error(message)
    api.code = 'API_ERROR'
    api.status = status
    throw api
  }
  throw error
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

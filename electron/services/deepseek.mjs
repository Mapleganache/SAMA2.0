import { loadSettings, getApiKeyFor } from './store.mjs'
import fs from 'node:fs'
import path from 'node:path'
import { getDataRoot } from './paths.mjs'

export const PROVIDERS = {
  groq: {
    id: 'groq',
    label: 'Groq（免费）',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B（推荐·文本·附图改用 Scout）' },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout（识图）' },
      { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B（更快）' },
      { id: 'gemma2-9b-it', label: 'Gemma2 9B' },
    ],
    keyHint: '免费申请：console.groq.com（一般不用绑卡）',
  },
  gemini: {
    id: 'gemini',
    label: 'Gemini（免费额度）',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash（推荐·识图）' },
      { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
      { id: 'gemini-2.0-flash-lite', label: 'gemini-2.0-flash-lite' },
      { id: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
    ],
    keyHint: '免费申请：aistudio.google.com/apikey',
  },
  grok: {
    id: 'grok',
    label: 'Grok（xAI）',
    baseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4-1-fast-non-reasoning',
    models: [
      { id: 'grok-4-1-fast-non-reasoning', label: 'grok-4.1-fast（推荐·快）' },
      { id: 'grok-4', label: 'grok-4' },
      { id: 'grok-3-mini', label: 'grok-3-mini' },
      { id: 'grok-3', label: 'grok-3' },
    ],
    keyHint: '在 console.x.ai 创建 API Key',
  },
  qwen: {
    id: 'qwen',
    label: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'qwen3.8-max',
    models: [
      { id: 'qwen3.8-max', label: 'qwen3.8-max（旗舰·识图）' },
      { id: 'qwen-vl-max', label: 'qwen-vl-max（识图）' },
      { id: 'qwen-vl-plus', label: 'qwen-vl-plus（识图）' },
      { id: 'qwen-plus', label: 'qwen-plus（文本·附图改用 VL）' },
      { id: 'qwen-turbo', label: 'qwen-turbo（文本·附图改用 VL）' },
      { id: 'qwen-max', label: 'qwen-max（文本·附图改用 VL）' },
    ],
    keyHint: '在 dashscope.console.aliyun.com 创建',
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o', label: 'gpt-4o（识图推荐）' },
      { id: 'gpt-4o-mini', label: 'gpt-4o-mini（识图·便宜）' },
    ],
    keyHint: '在 platform.openai.com/api-keys 创建（sk- 开头）',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', label: 'deepseek-chat' },
      { id: 'deepseek-reasoner', label: 'deepseek-reasoner' },
    ],
    keyHint: '在 platform.deepseek.com 创建',
  },
}

export function providerLabel(id) {
  return (PROVIDERS[id] || PROVIDERS.groq).label
}

function logDebug(line) {
  try {
    const file = path.join(getDataRoot(), 'debug.log')
    fs.appendFileSync(file, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
  } catch {
    // ignore
  }
}

function resolveProvider(settings) {
  const id = settings.provider || 'groq'
  return PROVIDERS[id] || PROVIDERS.groq
}

function friendlyApiError(status, msg, provider) {
  const text = String(msg || '')
  if (/overdue|good standing|欠费|逾期/i.test(text)) {
    return `${provider.label} 账号欠费或状态异常，请结清账单，或改用免费的 Groq / Gemini。原文：${text}`
  }
  if (status === 401 || /invalid.*api.?key|incorrect api key|unauthorized/i.test(text)) {
    return `${provider.label} API Key 无效或已失效，请在设置中重新填写。原文：${text}`
  }
  if (status === 402 || /insufficient|balance|额度|余额/i.test(text)) {
    return `${provider.label} 余额不足，请充值或改用免费的 Groq。原文：${text}`
  }
  if (status === 429) {
    return `${provider.label} 免费额度用尽或请求过快，请稍后再试，或换 Gemini。原文：${text}`
  }
  return `${provider.label} 错误 (${status}): ${text}`
}

/**
 * OpenAI 兼容 Chat Completions（通义 DashScope / DeepSeek）
 */
export async function chatWithLlm({
  messages,
  model,
  temperature = 0.3,
  maxTokens = 8192,
  timeoutMs,
  provider: providerId,
}) {
  const settings = loadSettings()
  const id = String(providerId || settings.provider || 'groq').toLowerCase()
  const provider = PROVIDERS[id] || PROVIDERS.groq
  const apiKey = getApiKeyFor(id, settings)

  if (!apiKey) {
    const err = new Error(`未配置 ${provider.label} API Key，请先在右上角「设置」中填写并保存。`)
    err.code = 'NO_API_KEY'
    throw err
  }

  const sameAsChat = id === String(settings.provider || 'groq').toLowerCase()
  const baseUrl = (sameAsChat ? settings.baseUrl || provider.baseUrl : provider.baseUrl).replace(
    /\/$/,
    '',
  )
  const useModel =
    model || (sameAsChat ? settings.model : null) || provider.defaultModel
  const hasImage = messages.some((m) => Array.isArray(m?.content))
  const waitMs = Number(timeoutMs) > 0 ? Number(timeoutMs) : hasImage ? 180000 : 120000

  logDebug(`request provider=${provider.id} model=${useModel} messages=${messages.length} maxTokens=${maxTokens} vision=${hasImage}`)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), waitMs)

  let res
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: useModel,
        messages,
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (e?.name === 'AbortError') {
      const err = new Error(`请求超时（${Math.round(waitMs / 1000)} 秒）。请检查网络是否能访问 ${baseUrl}`)
      err.code = 'TIMEOUT'
      throw err
    }
    const err = new Error(`网络错误：${e.message || e}`)
    err.code = 'NETWORK'
    throw err
  } finally {
    clearTimeout(timer)
  }

  const raw = await res.text()
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    logDebug(`bad json status=${res.status} body=${raw.slice(0, 300)}`)
    const err = new Error(`${provider.label} 返回异常：${raw.slice(0, 200)}`)
    err.code = 'BAD_RESPONSE'
    throw err
  }

  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText
    logDebug(`api error status=${res.status} msg=${msg}`)
    const err = new Error(friendlyApiError(res.status, msg, provider))
    err.code = 'API_ERROR'
    err.status = res.status
    throw err
  }

  const choice = data?.choices?.[0] || {}
  const message = choice.message || {}
  let content = message.content || ''
  if (!content && message.reasoning_content) {
    content = message.reasoning_content
  }

  if (!content) {
    logDebug(`empty content keys=${Object.keys(message).join(',')}`)
    const err = new Error(`${provider.label} 未返回有效内容`)
    err.code = 'EMPTY'
    throw err
  }

  const finishReason = choice.finish_reason || choice.finishReason || null
  logDebug(`ok model=${data.model || useModel} chars=${content.length} finish=${finishReason}`)
  return {
    content,
    model: data.model || useModel,
    usage: data.usage || null,
    provider: provider.id,
    finishReason,
  }
}

/** @deprecated 兼容旧导入名 */
export async function chatWithDeepSeek(args) {
  return chatWithLlm(args)
}

export async function testLlmConnection() {
  const result = await chatWithLlm({
    messages: [
      { role: 'system', content: '你是连通性测试助手，只回复：ok' },
      { role: 'user', content: 'ping' },
    ],
    temperature: 0,
  })
  return { ok: true, reply: result.content, model: result.model, provider: result.provider }
}

export async function testDeepSeekConnection() {
  return testLlmConnection()
}

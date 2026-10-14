import { loadLlmSettings } from './settings.mjs'

export async function callText({ system, user, temperature = 0.2, timeoutMs = 90000, maxTokens = 4096 }) {
  const run = () => complete({ system, user, temperature, timeoutMs, maxTokens })
  try {
    return await run()
  } catch (error) {
    const text = String(error?.message || error)
    if (error?.status === 429 || /429|请求过快|rate/i.test(text)) {
      await delay(2000)
      return run()
    }
    throw error
  }
}

async function complete({ system, user, temperature, timeoutMs, maxTokens }) {
  const settings = loadLlmSettings()
  if (!settings.apiKey) {
    const error = new Error('未配置 API Key。请在 sama2.0/settings.json 填写 apiKey，或设置环境变量 SAMA2_API_KEY。')
    error.code = 'NO_API_KEY'
    throw error
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let response
  try {
    response = await fetch(`${settings.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        max_tokens: maxTokens,
        stream: false,
      }),
      signal: controller.signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeout = new Error(`请求超时（${Math.round(timeoutMs / 1000)} 秒）`)
      timeout.code = 'TIMEOUT'
      throw timeout
    }
    const network = new Error(`网络错误：${error?.message || error}`)
    network.code = 'NETWORK'
    throw network
  } finally {
    clearTimeout(timer)
  }

  const raw = await response.text()
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    const error = new Error(`模型返回无法解析：${raw.slice(0, 180)}`)
    error.code = 'BAD_RESPONSE'
    throw error
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || response.statusText
    const error = new Error(`模型错误 (${response.status}): ${message}`)
    error.code = 'API_ERROR'
    error.status = response.status
    throw error
  }
  const content = data?.choices?.[0]?.message?.content || data?.choices?.[0]?.message?.reasoning_content || ''
  if (!content) {
    const error = new Error('模型未返回内容')
    error.code = 'EMPTY'
    throw error
  }
  return { content, model: data.model || settings.model }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

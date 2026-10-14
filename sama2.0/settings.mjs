import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(fileURLToPath(import.meta.url))
let runtime = { baseUrl: '', model: '', apiKey: '' }

export function sama2Root() {
  return ROOT
}

export function setRuntimeLlm(partial = {}) {
  runtime = {
    baseUrl: String(partial.baseUrl || '').trim(),
    model: String(partial.model || '').trim(),
    apiKey: String(partial.apiKey || '').trim(),
  }
}

export function loadLlmSettings() {
  const file = path.join(ROOT, 'settings.json')
  let saved = {}
  try {
    if (fs.existsSync(file)) saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    saved = {}
  }
  const baseUrl = String(runtime.baseUrl || process.env.SAMA2_BASE_URL || saved.baseUrl || 'https://api.deepseek.com').replace(/\/$/, '')
  const model = String(runtime.model || process.env.SAMA2_MODEL || saved.model || 'deepseek-chat')
  const apiKey = String(runtime.apiKey || process.env.SAMA2_API_KEY || saved.apiKey || '').trim()
  return { baseUrl, model, apiKey }
}

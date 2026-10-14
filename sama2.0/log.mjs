import fs from 'node:fs'
import path from 'node:path'
import { sama2Root } from './settings.mjs'

export function logEvent(event, fields = {}) {
  const file = path.join(sama2Root(), 'logs', 'sama2.log')
  const line = JSON.stringify({ t: new Date().toISOString(), event, ...fields })
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, `${line}\n`, 'utf8')
  } catch {
    // 日志失败不影响主链路
  }
}

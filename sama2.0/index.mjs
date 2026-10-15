/**
 * SAMA 2.0 入口。诊断流程在 LangGraph 状态图里：
 * intake → simple / need_info / classify / sample → verify。
 * 每一路求解是另一张图：model → tools → model，收束后进入 close。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

export { runSama2 } from './graph.mjs'

const selfPath = fileURLToPath(import.meta.url)
const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : ''
if (entryPath === selfPath) {
  const { runSama2 } = await import('./graph.mjs')
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

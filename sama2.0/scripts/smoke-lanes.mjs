/** 五路检索树对着真实库跑一遍；有密钥才继续走完整诊断。不要打印密钥。 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLaneEntries, runSqliteTree } from '../retrieval-tree.mjs'

const origin = '数控磨床，磨削中，热机，齿面粗糙度达不到要求，请直接给出最可能的原因和处置，不要向我提问。'
const entries = buildLaneEntries(origin, { count: 5, seedBase: 1000 })
const trees = []
for (const entry of entries) {
  const tree = await runSqliteTree({
    origin,
    firstQuery: entry.entryQuery,
    tauLane: entry.tau,
    hopCost: 0.05,
    retBudget: 8,
    beamK: 3,
    embedMode: 'hash',
  })
  trees.push(tree)
  const pathText = (tree.path || []).join(' / ')
  const ids = (tree.records || []).map((row) => row.id).join(', ')
  console.log(`路温 ${Number(entry.tau).toFixed(2)} | 入口 ${entry.entryQuery} | 路径 ${pathText} | G ${Number(tree.score).toFixed(3)} | ${ids}`)
}

const blob = trees.map((row) => `${(row.path || []).join(' ')} ${row.text || ''}`).join('\n')
if (!/爬行|导轨|润滑/.test(blob)) {
  console.error('五路检索树没有扩到爬行/导轨/润滑')
  process.exit(1)
}
console.log('sqlite five-lane tree ok')

if (process.argv.includes('--llm')) {
  const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
  const local = path.join(root, 'settings.json')
  const runtime = 'D:\\SAMA\\SAMA-data\\runtime\\settings.json'
  const file = fs.existsSync(local) ? local : runtime
  if (!process.env.SAMA2_API_KEY && fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (saved.apiKey) process.env.SAMA2_API_KEY = String(saved.apiKey)
    if (saved.baseUrl) process.env.SAMA2_BASE_URL = String(saved.baseUrl)
    if (saved.model) process.env.SAMA2_MODEL = String(saved.model)
  }
  if (!process.env.SAMA2_API_KEY) {
    console.log('skip llm: no API key')
    process.exit(0)
  }
  const { runSama2 } = await import('../index.mjs')
  const result = await runSama2({
    userText: origin,
    maxStep: 4,
    forceMultiAgent: true,
  })
  const ids = [...String(result.answer || '').matchAll(/sqlite_(?:curated|fragment|case):\d+/g)].map((row) => row[0])
  console.log(`llm route=${result.route} plans=${(result.plans || []).length} tree=${(result.plans || []).filter((plan) => (plan.trace || []).some((step) => step.reason === 'retrieval_tree')).length} cites=${ids.slice(0, 8).join(',')}`)
  console.log(String(result.answer || '').slice(0, 500))
}

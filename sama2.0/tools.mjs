import { databaseOptions } from './sama-sqlite/connection.mjs'
import { tool } from 'langchain'
import { z } from 'zod'
import { lookupBaseline } from './baselines.mjs'
import { identifyMachine } from './dialect.mjs'
import { parseAskUser } from './gaps.mjs'
import { searchLibrary } from './library.mjs'
import { recordMeasurement } from './measurements.mjs'
import { searchMtkb } from './mtkb.mjs'
import { searchWeb, isLibraryMiss, isWebMiss, toWebQuery } from './webSearch.mjs'

const text = z.string().optional()

export function buildDiagnosticTools({ query = '', facts = {}, allowWeb = false, webAuto = true, mtkbUrl = 'http://127.0.0.1:8765' } = {}) {
  // 本地库没命中时自动联网；只把带 URL 的结果交给模型，作为“候选参考”。
  const withWebFallback = (handler) => async (args) => {
    const local = await handler(args)
    if (!allowWeb || !webAuto || !isLibraryMiss(local, String(args?.query || query || ''))) return local
    const asked = String(args?.query || query || '')
    const web = await searchWeb({ query: asked.length <= 24 ? asked : toWebQuery(asked) })
    if (isWebMiss(web)) return `${local}\n\n【自动联网】本地库没有命中；联网检索也没有返回可引用 URL。`
    return `${local}\n\n【自动联网】本地库没有命中，以下是网页检索结果（部分为搜索引擎跳转链接）。只有这里出现的 URL 可以引用，且必须说明“来自网络、需核对是否适用于本机”：\n${web}`
  }
  const tools = [
    tool(
      withWebFallback(async ({ query: asked, subsystem, domain }) => searchLibrary(asked || '', {
        subsystem: String(subsystem || '').trim(),
        domain: String(domain || '').trim(),
      })),
      {
        name: 'search_knowledge',
        description: '检索本地磨床维修笔记。液压、润滑、主轴、进给、冷却都按机械检索。只有电路、电气、PLC、LAD 会说明没有该领域；其他未知 domain 忽略。SQLite启用时返回sqlite_curated/fragment/case:编号及原文定位，否则返回knowledge/文件#起-止。',
        schema: z.object({ query: text, subsystem: text, domain: text }).passthrough(),
      },
    ),
    tool(
      async ({ query: asked }) => {
        const rows = lookupBaseline(asked || query || '')
        if (!rows.length) return '未能从原文映射子系统。'
        return rows
          .map((row) => `${row.id}\n${row.subsystem}\n工具：${row.tools.join('、')}\n方向：${row.causes.join('；')}\n测点：${row.points.join('；')}`)
          .join('\n\n')
      },
      {
        name: 'lookup_baseline',
        description: '读取测点模板。对不上子系统时不会默认主轴。返回带 baseline/子系统。',
        schema: z.object({ query: text }).passthrough(),
      },
    ),
    tool(
      async ({ query: asked }) => {
        const machine = identifyMachine(asked || query || '')
        return `机床家族：${machine.label}（${machine.id}）\n维修约束：${machine.note}\n这项只用于识别机床家族，不能代替现场测量。`
      },
      {
        name: 'lookup_grind_dialect',
        description: '识别磨床家族。只识别家族，不提供数值。',
        schema: z.object({ query: text }).passthrough(),
      },
    ),
    tool(
      async (args) => {
        const parsed = parseAskUser(args)
        if (!parsed.ok) return `参数无效：${parsed.reason}`
        return `已记录向用户的提问：${parsed.questions.map((item) => item.text).join('；')}`
      },
      {
        name: 'ask_user',
        description: '仅在缺少机型、现象、空载/磨削、冷机/热机等硬分叉时提问。细节可先假设，不要反复追问。',
        schema: z.object({
          questions: z.array(z.object({ id: z.string().optional(), text: z.string().optional() }).passthrough()).optional(),
        }).passthrough(),
      },
    ),
    tool(
      async (args) => recordMeasurement(query, args),
      {
        name: 'record_measurement',
        description: '记下用户原文里已经写出的扭矩、间隙或压力。原文没有的数会被拒绝。',
        schema: z.object({ spec: text, quantity: text }).passthrough(),
      },
    ),
    tool(
      withWebFallback(async (args) => {
        const ignored = args.brand || args.domain || args.model ? '品牌与领域由程序填写。\n' : ''
        const database = databaseOptions()
        if (database) {
          const { searchLibrary: searchSqlite } = await import('./sama-sqlite/library.mjs')
          const machine = String(facts.machine || '未知').slice(0, 60)
          const scope = `本机SQLite；程序识别设备：${machine}。结果中的未知型号不代表与该设备匹配，仅作原文参考。\n`
          return ignored + scope + searchSqlite(args.query || '', { ...database, budget: 3200 })
        }
        const found = await searchMtkb({ query: args.query || '', facts, baseUrl: mtkbUrl })
        return ignored + found
      }),
      {
        name: 'search_mtkb',
        description: '查询本机案例与原理。SQLite启用时无需8765服务；品牌和型号由程序填写，未知型号不得当成本机匹配。' ,
        schema: z.object({ query: text }).passthrough(),
      },
    ),
    tool(
      async ({ code, controller }) => {
        try {
          const database = databaseOptions()
          if (!database) return '当前未启用 SQLite，无法查询报警表。'
          const { DatabaseSync } = await import('node:sqlite')
          const db = new DatabaseSync(database.dbPath, { readOnly: true })
          try {
            const raw = String(code || '').trim().toUpperCase().replace(/^#/, '').replace(/\s+/g, '')
            const compact = raw.replace(/[-–—]/g, '')
            let rows = []
            try {
              rows = db.prepare(`select code, controller, meaning, cause, action from alarm_codes
                where replace(replace(code,'-',''),'–','') = ? or code = ? limit 5`).all(compact, raw)
            } catch {
              return '当前资料库没有结构化报警表；请改用 search_knowledge 文本检索，不要猜报警含义。'
            }
            if (!rows.length) return `报警表没有查到 ${code || '(空)'}。不要猜测含义，改用文本检索或在回答里说明查不到。`
            return rows.map((row, index) => `[${index + 1}] ${row.code}（${row.controller}）${row.meaning}\n可能原因：${row.cause || '原文未给出'}\n排除方法：${row.action || '原文未给出'}`).join('\n\n')
          } finally {
            db.close()
          }
        } catch (error) {
          return `报警表查询失败：${error?.message || error}。不要猜报警含义。`
        }
      },
      {
        name: 'lookup_alarm',
        description: '按报警号精确查表（新代 OP-/MOT-/COR- 等）。args: {"code":"OP-001"}。查到就按表里的原因和排除方法回答；查不到就说明查不到，不要猜。',
        schema: z.object({ code: text, controller: text }).passthrough(),
      },
    ),
  ]
  if (allowWeb) {
    tools.push(tool(
      async ({ query: asked }) => searchWeb({ query: asked || '' }),
      {
        name: 'web_search',
        description: '网页检索（Bing；可用 SAMA2_SEARCH_URL/Tavily 替换）。本地库没命中时会自动附带联网结果；只有返回里出现的 URL 才能当作出处，并需说明是否适用于本机。',
        schema: z.object({ query: text }).passthrough(),
      },
    ))
  }
  return tools
}

export function createToolRunner(context = {}) {
  const tools = buildDiagnosticTools(context)
  const byName = new Map(tools.map((item) => [item.name, item]))
  return async function runTool(name, args = {}) {
    const found = byName.get(name)
    if (!found) return `未知工具 ${name}。请改用给定工具，或直接输出最终方案。`
    try {
      const result = await found.invoke(args && typeof args === 'object' ? args : {})
      return typeof result === 'string' ? result : String(result ?? '')
    } catch (error) {
      return `工具 ${name} 调用失败：${error?.message || error}。请基于已有信息继续，不要假装查到了资料。`
    }
  }
}

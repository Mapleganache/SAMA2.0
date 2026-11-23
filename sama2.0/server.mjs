import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSama2 } from './index.mjs'
import { loadLlmSettings, setRuntimeLlm } from './settings.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const page = path.join(root, 'public', 'index.html')
const reportFile = path.join(root, 'SAMA2-架构报告.md')
const port = Number(process.env.SAMA2_PORT) || 3920
const staticFiles = new Map([
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
])

const server = http.createServer(async (request, response) => {
  const pathname = String(request.url || '').split('?')[0]
  if (request.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' })
    response.end(fs.readFileSync(page))
    return
  }
  if (request.method === 'GET' && staticFiles.has(pathname)) {
    const [file, type] = staticFiles.get(pathname)
    response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' })
    response.end(fs.readFileSync(path.join(root, 'public', file)))
    return
  }
  if (request.method === 'GET' && pathname === '/report') {
    const markdown = fs.readFileSync(reportFile, 'utf8')
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end(renderReport(markdown))
    return
  }
  if (request.method === 'GET' && pathname === '/api/health') {
    const settings = loadLlmSettings()
    sendJson(response, 200, { ok: true, configured: Boolean(settings.apiKey), model: settings.model })
    return
  }
  if (request.method === 'POST' && pathname === '/api/ask') {
    try {
      const body = await readBody(request)
      setRuntimeLlm({
        apiKey: body.apiKey,
        baseUrl: body.baseUrl,
        model: body.model,
        judgeModel: body.judgeModel,
      })
      const result = await runSama2({
        userText: body.userText,
        forceMultiAgent: Boolean(body.forceMultiAgent),
        maxStep: body.maxStep,
        session: body.session,
        allowWeb: Boolean(body.allowWeb),
        webAuto: body.webAuto !== false,
        gateMode: body.gateMode,
        language: body.language === 'en' ? 'en' : 'zh',
      })
      sendJson(response, 200, {
        ok: true,
        answer: result.answer,
        route: result.route,
        complexity: result.complexity,
        facts: result.facts,
        plans: result.plans,
        judge: result.judge,
        accuracy: result.accuracy,
        flow: result.flow,
        rubric: result.rubric,
        meta: result.meta,
        missing: result.missing,
        assumptions: result.assumptions,
        pendingQuestions: result.pendingQuestions,
        questions: result.questions,
        deferred: result.deferred,
        rejected: result.rejected,
        session: result.session,
      })
    } catch (error) {
      sendJson(response, 200, { ok: false, error: error?.message || String(error), code: error?.code || '' })
    }
    return
  }
  response.writeHead(404)
  response.end('not found')
})

server.listen(port, '127.0.0.1', () => {
  console.log(`SAMA 2.0 已打开：http://127.0.0.1:${port}`)
})

function sendJson(response, status, data) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(data))
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ''
    request.on('data', (chunk) => {
      raw += chunk
      if (raw.length > 1_000_000) {
        reject(new Error('请求过大'))
        request.destroy()
      }
    })
    request.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {})
      } catch {
        reject(new Error('请求不是 JSON'))
      }
    })
    request.on('error', reject)
  })
}

function renderReport(markdown) {
  const body = markdownToHtml(markdown)
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>SAMA 2.0 架构报告</title>
  <style>
    body { font-family: "Segoe UI", sans-serif; margin: 32px auto; max-width: 920px; line-height: 1.65; color: #1c1c1c; }
    table { border-collapse: collapse; width: 100%; margin: 12px 0 20px; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f4f4f4; }
    code { background: #f4f4f4; padding: 0 4px; }
    a { color: #0b57d0; }
  </style>
</head>
<body>
<p><a href="/">返回诊断页</a></p>
${body}
</body>
</html>`
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').replace(/\r\n/g, '\n').split('\n')
  const html = []
  let list = []
  let table = []
  const flushList = () => {
    if (!list.length) return
    html.push(`<ul>${list.map((item) => `<li>${inline(item)}</li>`).join('')}</ul>`)
    list = []
  }
  const flushTable = () => {
    if (!table.length) return
    const rows = table.filter((row) => !/^\s*\|?\s*-+/.test(row.replace(/\|/g, '').trim()) && !/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(row))
    const cells = rows.map((row) => row.replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim()))
    const head = cells[0] || []
    const body = cells.slice(1)
    html.push(`<table><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`)
    table = []
  }
  for (const line of lines) {
    if (line.startsWith('|')) {
      flushList()
      table.push(line)
      continue
    }
    flushTable()
    if (line.startsWith('- ')) {
      list.push(line.slice(2))
      continue
    }
    flushList()
    if (!line.trim()) continue
    if (line.startsWith('### ')) html.push(`<h3>${inline(line.slice(4))}</h3>`)
    else if (line.startsWith('## ')) html.push(`<h2>${inline(line.slice(3))}</h2>`)
    else if (line.startsWith('# ')) html.push(`<h1>${inline(line.slice(2))}</h1>`)
    else html.push(`<p>${inline(line)}</p>`)
  }
  flushList()
  flushTable()
  return html.join('\n')
}

function inline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
}

function escapeHtml(text) {
  return String(text || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}



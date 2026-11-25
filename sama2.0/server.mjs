import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runSama2 } from './index.mjs'
import { loadLlmSettings, setRuntimeLlm } from './settings.mjs'

const root = path.dirname(fileURLToPath(import.meta.url))
const page = path.join(root, 'public', 'index.html')
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




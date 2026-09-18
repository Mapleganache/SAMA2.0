/**
 * PlcIR 物化：LadderIR + 仿真测试 + 助记符片段（不写 .LAD）
 */
import fs from 'node:fs'
import path from 'node:path'
import { validateIr } from '../validate.mjs'
import { compilePlcToLadder, ladderToFanucMnemonicSnippet } from './ladderIr.mjs'
import { runPlcTestSuite } from './tests.mjs'

function resolveOutDir(explicit = '') {
  if (explicit) {
    const p = path.resolve(explicit)
    fs.mkdirSync(p, { recursive: true })
    return p
  }
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron')
    if (app?.getPath) {
      const dir = path.join(app.getPath('userData'), 'sama-data', 'workspace', 'plc')
      fs.mkdirSync(dir, { recursive: true })
      return dir
    }
  } catch {
    /* node */
  }
  const dir = path.join(process.cwd(), 'workspace', 'plc')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * requireTestsPass: 默认 true — 仿真失败则拒绝 success
 */
export function materializePlcIr(ir, opts = {}) {
  const v = validateIr('plc', ir)
  if (!v.ok) {
    const err = new Error('PlcIR 校验失败')
    err.code = 'IR_INVALID'
    err.errors = v.errors
    throw err
  }

  const ladder = compilePlcToLadder(ir)
  const unsupported = (ladder.rungs || []).filter((r) => r.unsupported)
  if (unsupported.length && opts.allowUnsupported !== true) {
    const err = new Error(`含未支持逻辑: ${unsupported.map((r) => r.type).join(',')}`)
    err.code = 'PLC_UNSUPPORTED_LOGIC'
    err.data = { unsupported }
    throw err
  }

  const suite = runPlcTestSuite(ir)
  if (!suite.ok && opts.requireTestsPass !== false) {
    const err = new Error('PLC 仿真测试未通过')
    err.code = 'PLC_SIM_FAILED'
    err.data = suite
    throw err
  }

  const outDir = resolveOutDir(opts.outDir)
  const stem =
    String(opts.name || ir.meta?.name || 'plc')
      .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
      .slice(0, 80) || 'plc'
  const stamp = Date.now().toString(36)
  const base = `${stem}_${stamp}`

  const ladderPath = path.join(outDir, `${base}.ladder.json`)
  const asciiPath = path.join(outDir, `${base}.ladder.txt`)
  const mnePath = path.join(outDir, `${base}.mnemonic.txt`)
  const reportPath = path.join(outDir, `${base}.sim.json`)

  const mnemonic = ladderToFanucMnemonicSnippet(ladder)
  fs.writeFileSync(ladderPath, JSON.stringify(ladder, null, 2), 'utf8')
  fs.writeFileSync(asciiPath, ladder.ascii || '', 'utf8')
  fs.writeFileSync(mnePath, mnemonic, 'utf8')
  fs.writeFileSync(
    reportPath,
    JSON.stringify(
      {
        ok: suite.ok,
        total: suite.total,
        passed: suite.passed,
        failed: suite.failed,
        results: suite.results,
      },
      null,
      2,
    ),
    'utf8',
  )

  return {
    success: true,
    path: ladderPath,
    file: ladderPath,
    artifact: {
      ladderJson: ladderPath,
      ladderAscii: asciiPath,
      mnemonic: mnePath,
      simReport: reportPath,
      format: 'ladder+mnemonic+sim',
    },
    ladder,
    mnemonic,
    simulation: {
      ok: suite.ok,
      total: suite.total,
      passed: suite.passed,
      failed: suite.failed,
      results: (suite.results || []).map((t) => ({
        id: t.id,
        name: t.name,
        ok: t.ok,
      })),
    },
    verification: {
      ok: suite.ok && fs.existsSync(ladderPath),
      tests_pass: suite.ok,
      file_exists: true,
    },
    note:
      '仅生成 LadderIR/助记符片段与仿真报告。写入 .LAD 仍须 sama-allow-ladder，本适配器不调用 Fladder。',
  }
}

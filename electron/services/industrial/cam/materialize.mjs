/**
 * CamIR 物化：规划 → Post → 安全检查 → 写 NC（不下发机床）
 */
import fs from 'node:fs'
import path from 'node:path'
import { validateIr } from '../validate.mjs'
import { planCamOperations } from './toolpath.mjs'
import { postNc } from './post.mjs'
import { runNcSafetyChecks } from './safety.mjs'

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
      const dir = path.join(app.getPath('userData'), 'sama-data', 'workspace', 'cam')
      fs.mkdirSync(dir, { recursive: true })
      return dir
    }
  } catch {
    /* node */
  }
  const dir = path.join(process.cwd(), 'workspace', 'cam')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

export function materializeCamIr(ir, opts = {}) {
  const v = validateIr('cam', ir)
  if (!v.ok) {
    const err = new Error('CamIR 校验失败')
    err.code = 'IR_INVALID'
    err.errors = v.errors
    throw err
  }

  const toolpath = planCamOperations(ir, opts)
  const vendor = opts.vendor || ir.meta?.vendor || 'fanuc'
  const nc = postNc(toolpath, vendor, opts)
  const safety = runNcSafetyChecks(toolpath, nc, opts)

  if (!safety.ok && opts.requireSafe !== false) {
    const err = new Error('NC 安全检查未通过')
    err.code = 'NC_SAFETY_FAILED'
    err.data = safety
    throw err
  }

  const outDir = resolveOutDir(opts.outDir)
  const stem =
    String(opts.name || ir.meta?.name || 'cam')
      .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
      .slice(0, 80) || 'cam'
  const stamp = Date.now().toString(36)
  const base = `${stem}_${stamp}`
  const ncPath = path.join(outDir, `${base}.nc`)
  const tpPath = path.join(outDir, `${base}.toolpath.json`)
  const safetyPath = path.join(outDir, `${base}.safety.json`)

  fs.writeFileSync(ncPath, nc, 'utf8')
  fs.writeFileSync(tpPath, JSON.stringify(toolpath, null, 2), 'utf8')
  fs.writeFileSync(safetyPath, JSON.stringify(safety, null, 2), 'utf8')

  return {
    success: true,
    path: ncPath,
    file: ncPath,
    artifact: {
      nc: ncPath,
      toolpath: tpPath,
      safety: safetyPath,
      format: 'nc+toolpath+safety',
      vendor,
    },
    ncText: nc,
    toolpath,
    safety,
    verification: {
      ok: safety.ok && fs.existsSync(ncPath),
      safe: safety.safe,
      file_exists: true,
    },
    note: '已生成本地 NC 并完成安全检查。禁止自动传输到真实机床；须用户确认后再传输。',
  }
}

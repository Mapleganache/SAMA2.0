/**
 * CAD 产物写出与校验
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { summarizeCadGeometry, matchBbox } from './geometry.mjs'
import { buildDxfFromGeometry, parseDxfStats } from './dxfWriter.mjs'
import { validateIr } from '../validate.mjs'

export function resolveCadArtifactDir(explicit = '') {
  if (explicit) {
    const p = path.resolve(explicit)
    fs.mkdirSync(p, { recursive: true })
    return p
  }
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron')
    if (app?.getPath) {
      const dir = path.join(app.getPath('userData'), 'sama-data', 'workspace', 'cad')
      fs.mkdirSync(dir, { recursive: true })
      return dir
    }
  } catch {
    /* node smoke */
  }
  const dir = path.join(process.cwd(), 'workspace', 'cad')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * CADIR → DXF + geometry JSON
 * @returns 含 path / artifact / geometry / verification
 */
export function materializeCadIr(ir, opts = {}) {
  const v = validateIr('cad', ir)
  if (!v.ok) {
    const err = new Error('CADIR 校验失败')
    err.code = 'IR_INVALID'
    err.errors = v.errors
    throw err
  }

  const geometry = summarizeCadGeometry(ir)
  const outDir = resolveCadArtifactDir(opts.outDir)
  const stem =
    String(opts.name || ir.meta?.name || 'part')
      .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
      .slice(0, 80) || 'part'
  const stamp = Date.now().toString(36)
  const base = `${stem}_${stamp}`
  const dxfPath = path.join(outDir, `${base}.dxf`)
  const jsonPath = path.join(outDir, `${base}.geometry.json`)

  const dxf = buildDxfFromGeometry(geometry, { layer: opts.layer || 'SAMA' })
  fs.writeFileSync(dxfPath, dxf, 'utf8')
  const payload = {
    schemaVersion: 1,
    kind: 'cad.geometry',
    sourceKind: 'cad.ir',
    ir,
    geometry,
    dxf: path.basename(dxfPath),
    createdAt: new Date().toISOString(),
  }
  fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8')

  const verification = verifyCadArtifacts({
    dxfPath,
    jsonPath,
    expected: {
      bbox: geometry.bbox,
      holeCount: geometry.holeCount,
    },
  })

  if (!verification.ok) {
    const err = new Error('CAD 产物自检失败')
    err.code = 'CAD_VERIFY_FAILED'
    err.data = verification
    throw err
  }

  return {
    success: true,
    path: dxfPath,
    file: dxfPath,
    artifact: {
      dxf: dxfPath,
      geometryJson: jsonPath,
      format: 'dxf+json',
    },
    geometry,
    verification,
    note: 'DXF 为顶视 2D（矩形+圆孔）；三维尺寸在 geometry.json。非 SolidWorks 原生。',
  }
}

export function verifyCadArtifacts({ dxfPath, jsonPath, expected = {} } = {}) {
  const checks = []
  const dxfExists = !!(dxfPath && fs.existsSync(dxfPath))
  checks.push({ name: 'dxf_exists', ok: dxfExists })

  let stats = { circles: 0, polylines: 0 }
  if (dxfExists) {
    const text = fs.readFileSync(dxfPath, 'utf8')
    stats = parseDxfStats(text)
    checks.push({ name: 'dxf_has_outline', ok: stats.polylines >= 1 || stats.circles >= 1 })
  }

  let geometry = null
  const jsonExists = !!(jsonPath && fs.existsSync(jsonPath))
  checks.push({ name: 'geometry_json_exists', ok: jsonExists })
  if (jsonExists) {
    try {
      const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
      geometry = j.geometry
    } catch {
      checks.push({ name: 'geometry_json_parse', ok: false })
    }
  }

  let size_match = true
  let holes_match = true
  if (expected.bbox && geometry?.bbox) {
    size_match = matchBbox(geometry.bbox, expected.bbox)
    checks.push({ name: 'size_match', ok: size_match, actual: geometry.bbox, expected: expected.bbox })
  }
  if (expected.holeCount != null && geometry) {
    holes_match = Number(geometry.holeCount) === Number(expected.holeCount)
    checks.push({
      name: 'holes_match',
      ok: holes_match,
      actual: geometry.holeCount,
      expected: expected.holeCount,
    })
  }
  if (expected.holeCount != null && dxfExists) {
    const circleOk = stats.circles === Number(expected.holeCount)
    checks.push({ name: 'dxf_circle_count', ok: circleOk, actual: stats.circles, expected: expected.holeCount })
    if (!circleOk) holes_match = false
  }

  const ok = checks.every((c) => c.ok)
  return {
    ok,
    success: ok,
    geometry: geometry
      ? {
          bbox: geometry.bbox,
          holes: geometry.holeCount,
        }
      : null,
    verification: {
      size_match,
      holes_match,
      file_exists: dxfExists && jsonExists,
    },
    checks,
    dxfStats: stats,
  }
}

/** 从已写 geometry.json 再验 */
export function verifyFromGeometryJson(jsonPath, expected) {
  if (!fs.existsSync(jsonPath)) {
    return { ok: false, success: false, error: { code: 'FILE_NOT_FOUND', message: jsonPath } }
  }
  const j = JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
  const dir = path.dirname(jsonPath)
  const dxfPath = j.dxf ? path.join(dir, j.dxf) : null
  return verifyCadArtifacts({
    dxfPath,
    jsonPath,
    expected: expected || {
      bbox: j.geometry?.bbox,
      holeCount: j.geometry?.holeCount,
    },
  })
}

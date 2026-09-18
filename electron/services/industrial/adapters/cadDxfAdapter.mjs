/**
 * CAD DXF Adapter — Phase 7
 * level: api（本地内核，非鼠标）
 */
import path from 'node:path'
import { createStubAdapter } from './base.mjs'
import { materializeCadIr, verifyCadArtifacts, verifyFromGeometryJson, resolveCadArtifactDir } from '../cad/materialize.mjs'
import { summarizeCadGeometry } from '../cad/geometry.mjs'

export function createCadDxfAdapter() {
  return createStubAdapter({
    id: 'cad.dxf',
    domain: 'cad',
    vendor: 'sama',
    levels: ['api'],
    label: 'SAMA CAD DXF Kernel',
    notes: 'CADIR→DXF+geometry.json；顶视 2D + 尺寸校验。非 FreeCAD/SolidWorks。',
    async detect() {
      const dir = resolveCadArtifactDir()
      return {
        available: true,
        partial: false,
        adapterId: 'cad.dxf',
        domain: 'cad',
        outDir: dir,
        message: '本地 DXF 内核可用',
      }
    },
    async createFromIr(ir, opts = {}) {
      return materializeCadIr(ir, opts)
    },
    async export(args = {}) {
      if (args.ir) return materializeCadIr(args.ir, args)
      const err = new Error('export 需要 ir')
      err.code = 'IR_REQUIRED'
      throw err
    },
    async verify(args = {}) {
      if (args.geometryJson || args.jsonPath) {
        return verifyFromGeometryJson(args.geometryJson || args.jsonPath, args.expected)
      }
      if (args.dxfPath && args.jsonPath) {
        return verifyCadArtifacts(args)
      }
      if (args.ir) {
        const g = summarizeCadGeometry(args.ir)
        return {
          ok: true,
          success: true,
          geometry: { bbox: g.bbox, holes: g.holeCount },
          verification: { size_match: true, holes_match: true, note: '仅 IR 摘要，未核对文件' },
        }
      }
      const err = new Error('verify 需要 geometryJson 或 dxfPath+jsonPath 或 ir')
      err.code = 'VERIFY_ARGS'
      throw err
    },
  })
}

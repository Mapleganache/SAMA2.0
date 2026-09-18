/**
 * 工业工程管道（内存）：创建项目 / 挂载域 / 校验
 * 不写假成功文件。
 */
import { createEmptyProject } from './schemas/project.mjs'
import { createEmptyCadIr } from './schemas/cad.mjs'
import { createEmptyElectricalIr } from './schemas/electrical.mjs'
import { createEmptyPlcIr } from './schemas/plc.mjs'
import { createEmptyCamIr } from './schemas/cam.mjs'
import { validateIr, validateProject } from './validate.mjs'
import * as registry from './adapters/registry.mjs'

const DOMAIN_FACTORY = {
  cad: createEmptyCadIr,
  electrical: createEmptyElectricalIr,
  plc: createEmptyPlcIr,
  cam: createEmptyCamIr,
}

export function createProject(partial = {}) {
  const project = createEmptyProject(partial)
  const v = validateProject(project)
  return { project, validation: v }
}

export function attachDomain(project, domain, ir) {
  if (!project || typeof project !== 'object') {
    const err = new Error('需要 project 对象')
    err.code = 'PROJECT_REQUIRED'
    throw err
  }
  const d = String(domain || '').toLowerCase()
  if (!DOMAIN_FACTORY[d]) {
    const err = new Error(`未知域: ${domain}`)
    err.code = 'DOMAIN_UNKNOWN'
    throw err
  }
  const empty = DOMAIN_FACTORY[d]()
  const merged = { ...empty, ...(ir && typeof ir === 'object' ? ir : {}), kind: empty.kind }
  const domainValidation = validateIr(d, merged)
  const next = {
    ...project,
    domains: {
      ...(project.domains || {}),
      [d]: merged,
    },
  }
  const projectValidation = validateProject(next)
  return {
    project: next,
    domain,
    domainValidation,
    projectValidation,
    ok: domainValidation.ok,
  }
}

/**
 * 尝试用 Registry 中适配器从 IR 创建
 * Phase 7：cad.dxf 可真实写出 DXF；null stub 仍为 NOT_IMPLEMENTED
 */
export async function tryCreateFromIr(domain, ir, { adapterId } = {}) {
  const domainValidation = validateIr(domain, ir)
  if (!domainValidation.ok) {
    return {
      success: false,
      error: { code: 'IR_INVALID', message: 'IR 校验失败', errors: domainValidation.errors },
      domainValidation,
    }
  }

  let adapter = adapterId ? registry.get(adapterId) : null
  if (adapter && registry.isNullStub(adapter)) adapter = null
  if (!adapter) {
    const best = await registry.resolveBest({ domain, forCreate: true })
    adapter = best?.adapter || null
  }
  if (!adapter) {
    return {
      success: false,
      error: { code: 'ADAPTER_NOT_FOUND', message: `无 ${domain} 适配器` },
      domainValidation,
    }
  }

  try {
    const result = await adapter.createFromIr(ir)
    // 防假成功：若 stub 误返回 success 且无产物，仍视为失败
    if (result && result.success === true && !result.artifact && !result.path && !result.file) {
      return {
        success: false,
        error: {
          code: 'FAKE_SUCCESS_REJECTED',
          message: '适配器声称成功但无产物，已拒绝',
        },
        adapterId: adapter.id,
      }
    }
    return { success: true, adapterId: adapter.id, data: result, domainValidation }
  } catch (e) {
    return {
      success: false,
      error: { code: e.code || 'ADAPTER_FAILED', message: e.message || String(e) },
      adapterId: adapter.id,
      domainValidation,
    }
  }
}

export function listCapabilities() {
  return registry.probeAll()
}

/**
 * 跨域工作流运行器
 */
import fs from 'node:fs'
import path from 'node:path'
import { createProject, attachDomain, tryCreateFromIr } from '../pipeline.mjs'
import { compilePlcToLadder } from '../plc/ladderIr.mjs'
import { runTrace } from '../plc/simulator.mjs'
import { buildClampCylinderIrs } from './clampCylinder.mjs'
import {
  packIndustrialProject,
  listIndustrialProjects,
  resolveProjectsRoot,
} from '../projectPackager.mjs'

const WORKFLOWS = {
  clamp_cylinder: {
    id: 'clamp_cylinder',
    label: '气缸自动夹紧机构',
    build: buildClampCylinderIrs,
  },
}

export function listWorkflows() {
  return Object.values(WORKFLOWS).map((w) => ({
    id: w.id,
    label: w.label,
  }))
}

export function getWorkflow(id) {
  return WORKFLOWS[id] || null
}

function resolveOutDir(explicit = '') {
  return resolveProjectsRoot(explicit)
}

export function listProjects(opts = {}) {
  return listIndustrialProjects(resolveProjectsRoot(opts.root || opts.outDir || ''))
}

function verifyClampSequence(plcIr, holdMs) {
  const ladder = compilePlcToLadder(plcIr)
  const steps = []
  // start → M0/Y0
  steps.push({
    holdMs: 100,
    inputs: { X0: 1, X1: 0, X2: 0, X3: 0, M1: 0 },
    expect: { M0: 1, Y0: 1 },
  })
  // seal M0, keep clamping, not yet held
  steps.push({
    holdMs: 100,
    inputs: { X0: 0, X1: 0, X2: 0, X3: 0 },
    expect: { M0: 1, Y0: 1, Y1: 0 },
  })
  // clamped sensor → wait hold
  steps.push({
    holdMs: holdMs + 200,
    inputs: { X0: 0, X1: 0, X2: 1, X3: 0 },
    expect: { M1: 1, Y1: 1, Y0: 0 },
  })
  return runTrace(ladder, steps)
}

/**
 * 运行跨域 MVP 工作流
 */
export async function runIndustrialWorkflow(workflowId, opts = {}) {
  const wf = getWorkflow(workflowId)
  if (!wf) {
    return {
      success: false,
      error: { code: 'WORKFLOW_UNKNOWN', message: `未知工作流: ${workflowId}` },
    }
  }

  const pack = wf.build(opts)
  const domains = opts.domains || ['cad', 'electrical', 'plc', 'cam']
  let { project } = createProject({
    name: pack.name,
    meta: { workflow: pack.id, holdMs: pack.holdMs },
  })

  const domainResults = {}
  const artifacts = []

  for (const d of domains) {
    const ir = pack.domains[d]
    if (!ir) continue
    const attached = attachDomain(project, d, ir)
    project = attached.project
    if (!attached.ok) {
      return {
        success: false,
        error: {
          code: 'DOMAIN_IR_INVALID',
          message: `${d} IR 无效`,
          errors: attached.domainValidation.errors,
        },
        project,
        pack,
      }
    }
    const created = await tryCreateFromIr(d, ir)
    domainResults[d] = created
    if (!created.success) {
      return {
        success: false,
        error: {
          code: 'DOMAIN_CREATE_FAILED',
          message: `${d} 生成失败: ${created.error?.message || created.error?.code}`,
          domain: d,
          detail: created.error,
        },
        project,
        pack,
        domainResults,
      }
    }
    const art = created.data?.artifact || {}
    for (const [k, p] of Object.entries(art)) {
      if (typeof p === 'string' && (p.includes('\\') || p.includes('/'))) {
        artifacts.push({ domain: d, kind: k, path: p })
      }
    }
  }

  // 工作流级 PLC 序贯验证
  let sequence = null
  if (domains.includes('plc') && pack.domains.plc) {
    sequence = verifyClampSequence(pack.domains.plc, pack.holdMs)
    if (!sequence.ok && opts.requireSequence !== false) {
      return {
        success: false,
        error: {
          code: 'WORKFLOW_SEQUENCE_FAILED',
          message: '夹紧序贯仿真未通过',
          detail: sequence,
        },
        project,
        pack,
        domainResults,
        artifacts,
      }
    }
  }

  const outDir = resolveOutDir(opts.outDir)
  const stamp = Date.now().toString(36)
  const projDir = path.join(outDir, `${pack.name}_${stamp}`)
  fs.mkdirSync(projDir, { recursive: true })

  const reportDraft = {
    workflow: pack.id,
    name: pack.name,
    holdMs: pack.holdMs,
    description: pack.description,
    ioTable: pack.ioTable,
    domains: Object.keys(domainResults),
    artifacts,
    sequence: sequence ? { ok: sequence.ok, log: sequence.log } : null,
    createdAt: new Date().toISOString(),
  }
  const reportMd = buildReportMarkdown(reportDraft, domainResults, pack)

  const packed = packIndustrialProject({
    projDir,
    pack,
    domainResults,
    sequence,
    reportMarkdown: reportMd,
  })

  const finalArtifacts = packed.packagedArtifacts
  project.artifacts = finalArtifacts
  project.projectDir = projDir
  project.disk = packed.projectMeta

  return {
    success: true,
    workflow: pack.id,
    project,
    pack: { id: pack.id, name: pack.name, holdMs: pack.holdMs, description: pack.description },
    domainResults: Object.fromEntries(
      Object.entries(domainResults).map(([k, v]) => [
        k,
        {
          success: v.success,
          adapterId: v.adapterId,
          artifact: v.data?.artifact,
          note: v.data?.note,
        },
      ]),
    ),
    preview: buildUiPreview(pack, domainResults, sequence, reportMd),
    sequence: sequence ? { ok: sequence.ok } : null,
    projectDir: projDir,
    reportPath: packed.reportPath,
    projectJsonPath: packed.projectJsonPath,
    tree: packed.tree,
    artifacts: finalArtifacts,
    path: packed.reportPath,
    file: packed.reportPath,
    note: '样例已生成，见下方展示。不含真实机床下发；改 .LAD 仍须允许。',
  }
}

function buildUiPreview(pack, domainResults, sequence, reportMd) {
  const plc = domainResults.plc?.data || {}
  const elec = domainResults.electrical?.data || {}
  const cam = domainResults.cam?.data || {}
  const cad = domainResults.cad?.data || {}
  return {
    title: pack.name,
    description: pack.description,
    ioTable: pack.ioTable || [],
    sequenceOk: sequence ? Boolean(sequence.ok) : undefined,
    reportMarkdown: String(reportMd || '').slice(0, 6000),
    plc: domainResults.plc
      ? {
          ascii: plc.ladder?.ascii || '',
          mnemonic: plc.mnemonic || '',
          rungs: (plc.ladder?.rungs || []).map((r) => ({
            id: r.id,
            type: r.type,
            comment: r.comment,
            ascii: r.ascii,
          })),
          symbols: plc.ladder?.symbols || null,
          simulation: plc.simulation || null,
        }
      : undefined,
    electrical: domainResults.electrical
      ? {
          svg: elec.svg || '',
          bom: elec.bom || [],
        }
      : undefined,
    cam: domainResults.cam
      ? {
          nc: cam.ncText || '',
        }
      : undefined,
    cad: domainResults.cad
      ? {
          geometry: cad.geometry || null,
        }
      : undefined,
  }
}

function buildReportMarkdown(manifest, domainResults, pack) {
  const lines = []
  lines.push(`# ${manifest.name} — 工程设计报告`)
  lines.push('')
  lines.push(`工作流：\`${manifest.workflow}\``)
  lines.push('')
  lines.push(pack.description || '')
  lines.push('')
  lines.push('## 工程目录')
  lines.push('')
  lines.push('- `mechanical/` 机械图 / CAD')
  lines.push('- `electrical/` 电气原理 / BOM / I/O')
  lines.push('- `plc/` 梯形与仿真')
  lines.push('- `manufacturing/` NC / 刀路')
  lines.push('- `reports/` 设计报告与清单')
  lines.push('')
  lines.push('## I/O 表')
  lines.push('')
  lines.push('| 地址 | 名称 | 设备 |')
  lines.push('|------|------|------|')
  for (const row of manifest.ioTable || []) {
    lines.push(`| ${row.addr} | ${row.name} | ${row.device} |`)
  }
  lines.push('')
  lines.push('## 域生成结果')
  lines.push('')
  for (const [d, r] of Object.entries(domainResults)) {
    lines.push(`### ${d}`)
    lines.push(`- adapter: \`${r.adapterId}\``)
    lines.push(`- success: ${r.success}`)
    if (r.data?.artifact) {
      for (const [k, p] of Object.entries(r.data.artifact)) {
        if (typeof p === 'string' && k !== 'format' && k !== 'vendor') {
          lines.push(`- ${k}: \`${p}\``)
        }
      }
    }
    lines.push('')
  }
  lines.push('## 序贯验证')
  lines.push('')
  lines.push(manifest.sequence?.ok ? '通过：启动 → 夹紧 → 保持 → 松开' : '未通过或未执行')
  lines.push('')
  lines.push('## 产物清单')
  lines.push('')
  for (const a of manifest.artifacts || []) {
    lines.push(`- [${a.domain}/${a.kind}] ${a.path}`)
  }
  lines.push('')
  lines.push('---')
  lines.push('SAMA Industrial Project — 不自动下发机床 / 不自动改 FANUC LAD。')
  lines.push('')
  return lines.join('\n')
}

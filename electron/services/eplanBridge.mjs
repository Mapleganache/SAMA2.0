import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { probeEplan, resolveEplanExe, detectEplanVersion, EPLAN_PREFERRED_VERSION, killEplanConflicts, findEplanConflicts } from './eplanP8.mjs'
import { electricalProjectDrc, electricalProjectExport, normalizeElectricalProjectV2 } from './electrical/electricalProjectV2.mjs'

/** 逻辑名 → 本机可能出现的文件名（2.9 Unicode 为 *u.dll / AFu.dll） */
const REQUIRED_ASSEMBLY_VARIANTS = [
  { canonical: 'Eplan.EplApi.Base.dll', variants: ['Eplan.EplApi.Base.dll', 'Eplan.EplApi.Baseu.dll'] },
  { canonical: 'Eplan.EplApi.DataModel.dll', variants: ['Eplan.EplApi.DataModel.dll', 'Eplan.EplApi.DataModelu.dll'] },
  {
    canonical: 'Eplan.EplApi.ApplicationFramework.dll',
    variants: ['Eplan.EplApi.ApplicationFramework.dll', 'Eplan.EplApi.AFu.dll', 'Eplan.EplApi.ApplicationFrameworku.dll'],
  },
  {
    canonical: 'Eplan.EplApi.System.dll',
    variants: ['Eplan.EplApi.System.dll', 'Eplan.EplApi.Systemu.dll'],
  },
]

const API_SEARCH_ROOTS = [
  'D:\\Program Files\\EPLAN',
  'C:\\Program Files\\EPLAN',
  'C:\\Program Files (x86)\\EPLAN',
]

function detectVersionFromPath(filePath) {
  const parts = filePath.split(/[/\\]/)
  for (const p of parts) {
    if (/^\d+\.\d+(?:\.\d+)?$/.test(p)) return p
  }
  return ''
}

function assemblySearchRoots(exe) {
  const roots = new Set()
  if (exe) {
    roots.add(path.dirname(exe))
    roots.add(path.dirname(path.dirname(exe)))
    roots.add(path.join(path.dirname(path.dirname(exe)), 'Bin'))
    roots.add(path.join(path.dirname(path.dirname(exe)), 'API'))
    const ver = detectVersionFromPath(exe)
    if (ver) {
      for (const base of API_SEARCH_ROOTS) {
        roots.add(path.join(base, 'Platform', ver, 'Bin'))
      }
    }
  }
  for (const r of API_SEARCH_ROOTS) {
    if (fs.existsSync(r)) roots.add(r)
  }
  return [...roots]
}

function findAssembly(root, name, maxDepth = 5) {
  const queue = [{ directory: root, depth: 0 }]
  while (queue.length) {
    const { directory, depth } = queue.shift()
    let entries = []
    try { entries = fs.readdirSync(directory, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name)
      if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) return absolute
      if (entry.isDirectory() && depth < maxDepth && !['Data', 'Projects', 'Temp', 'zh-CN'].includes(entry.name)) {
        queue.push({ directory: absolute, depth: depth + 1 })
      }
    }
  }
  return ''
}

function findAssemblyVariants(roots, variants) {
  for (const name of variants) {
    const hit = roots.map((root) => findAssembly(root, name)).find(Boolean)
    if (hit) return hit
  }
  return ''
}

function bridgeCandidates() {
  const localDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../resources/eplan-bridge')
  const names = [
    'Sama.Eplan27Bridge.exe',
    'Sama.EplanBridge.exe',
    'Sama.Eplan29Bridge.exe',
  ]
  const out = []
  for (const name of names) {
    out.push(path.join(process.resourcesPath, 'eplan-bridge', name))
    out.push(path.join(localDir, name))
  }
  out.push(path.join(localDir, 'publish', 'Sama.Eplan29Bridge.dll'))
  return out
}

function runBridgeExecutable(bridgePath, args, cwd, { visible = false } = {}) {
  const isDll = bridgePath.toLowerCase().endsWith('.dll')
  const opts = { cwd, encoding: 'utf8', timeout: 15 * 60 * 1000, windowsHide: !visible }
  if (isDll) {
    return spawnSync('dotnet', [bridgePath, ...args], opts)
  }
  return spawnSync(bridgePath, args, opts)
}

function probeBridgeRuntime(bridgePath, eplanExe) {
  if (!bridgePath || !fs.existsSync(bridgePath)) return { ok: false, apiReady: false }
  try {
    const r = runBridgeExecutable(bridgePath, ['--probe', '--eplan', eplanExe], path.dirname(bridgePath))
    const text = `${r.stdout || ''}\n${r.stderr || ''}`
    const apiReady = /apiReady\s*[:=]\s*true/i.test(text) || r.status === 0 && /API_READY/i.test(text)
    return { ok: r.status === 0 || r.status === 2, apiReady, exit: r.status, output: text.slice(0, 2000) }
  } catch (e) {
    return { ok: false, apiReady: false, error: String(e.message || e) }
  }
}

export function probeEplanAutomation(explicit = '') {
  const base = probeEplan(explicit)
  if (!base.found) return { ...base, apiAvailable: false, bridgeAvailable: false, mode: 'task-pack', assemblies: [], hint: `${base.hint} 当前仍可生成 EPLAN 导入任务包。` }
  const exe = resolveEplanExe(explicit)
  const version = detectEplanVersion(exe) || base.eplanVersion || '未知'
  const roots = assemblySearchRoots(exe)
  const assemblies = REQUIRED_ASSEMBLY_VARIANTS.map((entry) => findAssemblyVariants(roots, entry.variants))
  const bridgePath = bridgeCandidates().find((candidate) => fs.existsSync(candidate)) || ''
  const bridgeAvailable = Boolean(bridgePath)
  const bridgeProbe = bridgePath ? probeBridgeRuntime(bridgePath, exe) : { ok: false, apiReady: false }
  const conflicts = findEplanConflicts()
  const dllReady = assemblies.every(Boolean)
  // 桥接 --probe 为权威结果；Node 侧 DLL 扫描作辅助
  const apiAvailable = bridgeAvailable && bridgeProbe.apiReady
  let mode = 'task-pack'
  if (apiAvailable && bridgeAvailable) mode = 'official-api'
  else if (bridgeAvailable) mode = 'bridge-pack'

  const missingDll = REQUIRED_ASSEMBLY_VARIANTS.filter((_, i) => !assemblies[i]).map((e) => e.canonical)
  const hintParts = [`已找到 EPLAN ${version}`]
  if (apiAvailable) {
    hintParts.push('官方 API 桥接已就绪')
  } else if (bridgeAvailable && dllReady) {
    hintParts.push('桥接程序已安装，运行自检未通过 API；将生成任务包')
  } else if (bridgeAvailable) {
    hintParts.push('桥接程序已安装；API 自检未通过，将生成任务包')
  } else {
    hintParts.push('未找到 Sama.Eplan29Bridge.exe，将仅生成导入任务包')
  }
  if (missingDll.length && !apiAvailable) hintParts.push(`缺少：${missingDll.join(', ')}`)
  if (conflicts.length) hintParts.push(`检测到占用进程：${conflicts.join(', ')}（API 调用前需关闭或允许 SAMA 结束）`)
    ...base, eplanPath: exe, eplanVersion: version, preferredVersion: EPLAN_PREFERRED_VERSION,
    assemblies, apiAvailable, bridgeAvailable, bridgePath, bridgeProbe, missingDll, conflicts,
    mode,
    hint: hintParts.join(' · '),
  }
}

/** API Init 冒烟（120s 超时）；需无冲突进程或先 killEplanConflicts。 */
export function probeEplanApiInvoke(explicit = '', { killConflicts = true, visible = false } = {}) {
  const base = probeEplanAutomation(explicit)
  if (!base.bridgeAvailable || !base.bridgePath) return { ...base, apiInvokeOk: false, hint: '桥接未安装' }
  if (killConflicts && base.conflicts?.length) killEplanConflicts()
  const platBin = base.assemblies?.[0] ? path.dirname(base.assemblies[0]) : ''
  const cwd = platBin && fs.existsSync(platBin) ? platBin : path.dirname(base.eplanPath)
  const out = path.join(os.tmpdir(), 'sama-eplan-api-smoke')
  fs.mkdirSync(out, { recursive: true })
  const r = runBridgeExecutable(
    base.bridgePath,
    ['--invoke-smoke', '--kill-eplan', '--eplan', base.eplanPath, '--output', out],
    cwd,
    { visible },
  )
  const text = `${r.stdout || ''}\n${r.stderr || ''}`
  const apiInvokeOk = /invokeOk\s*=\s*true/i.test(text) && r.status === 0
  let check = null
  try {
    const p = path.join(out, 'project-check.json')
    if (fs.existsSync(p)) check = JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch { /* ignore */ }
  return {
    ...base,
    apiInvokeOk,
    apiInvokeExit: r.status,
    apiInvokeOutput: text.slice(0, 4000),
    apiInvokeCheck: check,
    mode: apiInvokeOk ? 'official-api' : base.mode,
    apiAvailable: apiInvokeOk,
  }
}

function writeTaskPackNotes(root, project, probe, drc) {
  const ver = probe.eplanVersion || EPLAN_PREFERRED_VERSION
  const manifest = {
    format: 'SAMA-EPLAN-TASK-PACK', version: 1, generatedAt: new Date().toISOString(),
    nativeEplanProjectGenerated: false, requestedEplanVersion: ver, preferredVersion: EPLAN_PREFERRED_VERSION, projectId: project.id,
    counts: {
      sheets: project.sheets.length,
      devices: project.sheets.reduce((n, s) => n + s.devices.length, 0),
      nets: project.sheets.reduce((n, s) => n + s.nets.length, 0), terminals: project.terminals.length,
      cables: project.cables.length, plcIo: project.plcIo.length,
    },
    drc: { errors: drc.errors, warnings: drc.warnings }, probe,
  }
  fs.writeFileSync(path.join(root, 'EPLAN任务包清单.json'), JSON.stringify(manifest, null, 2), 'utf8')
  fs.writeFileSync(path.join(root, 'EPLAN_导入说明.txt'), [
    `SAMA → EPLAN Electric P8 ${ver} 导入任务包（许可优先建议 ${EPLAN_PREFERRED_VERSION}）`, '',
    '重要：此目录不是原生 EPLAN 工程，未生成或修改任何 .edb。',
    '请在 EPLAN 中新建空工程，再按公司模板建立页，依据 PDF/DXF 与 CSV 表导入或录入。',
    '所有“待现场核对”的线号、端子号、PLC 地址和参数必须先对照原图、铭牌或实测。',
    '建议顺序：1. 导入设备与 BOM；2. 建立端子和 PLC I/O；3. 依据连接表布线；4. 更新连接和交叉引用；5. 执行项目检查；6. 备份为 .zw1。',
    '', `DRC：${drc.errors} 个错误，${drc.warnings} 个警告。存在错误时不得作为施工图。`,
  ].join('\r\n'), 'utf8')
}

export function eplanExportPreview(raw, explicit = '') {
  const project = normalizeElectricalProjectV2(raw)
  const probe = probeEplanAutomation(explicit)
  const drc = electricalProjectDrc(project)
  return {
    ok: true, mode: probe.mode, probe, drc,
    changes: {
      projectName: project.name, sheets: project.sheets.length,
      devices: project.sheets.reduce((n, s) => n + s.devices.length, 0),
      connections: project.sheets.reduce((n, s) => n + s.nets.length, 0),
      terminals: project.terminals.length, plcIo: project.plcIo.length,
    },
    warning: drc.errors ? 'DRC 存在错误，只允许导出审查任务包，不调用 EPLAN 自动化。' : '',
  }
}

export async function exportElectricalToEplan(parentWindow, raw, { eplanPath = '', confirmed = false, outDir = '', silent = false } = {}) {
  const project = normalizeElectricalProjectV2(raw)
  const probe = probeEplanAutomation(eplanPath)
  const drc = electricalProjectDrc(project)
  const exportOptions = outDir ? { outDir: String(outDir).trim() } : {}
  const exported = await electricalProjectExport(
    silent && outDir ? null : parentWindow,
    project,
    ['json', 'svg', 'pdf', 'dxf', 'tables', 'drc'],
    exportOptions,
  )
  if (!exported.ok) return exported
  writeTaskPackNotes(exported.root, project, probe, drc)
  if (!confirmed || drc.errors || probe.mode !== 'official-api') {
    const note =
      drc.errors
        ? 'DRC 有错误，已生成审查任务包；未调用 EPLAN。'
        : probe.mode === 'bridge-pack'
          ? '已生成任务包；桥接已安装但 API 未就绪，请在 EPLAN 中手工导入或安装 API 后重试。'
          : '已生成 EPLAN 导入任务包；尚未生成原生工程。'
    return { ...exported, mode: probe.mode || 'task-pack', nativeEplanProjectGenerated: false, probe, note }
  }
  const bridgeOut = path.join(exported.root, 'EPLAN原生输出')
  fs.mkdirSync(bridgeOut, { recursive: true })
  if (probe.conflicts?.length) killEplanConflicts()
  const platBin = probe.assemblies?.find(Boolean) ? path.dirname(probe.assemblies.find(Boolean)) : ''
  const bridgeCwd = platBin && fs.existsSync(platBin) ? platBin : exported.root
  const input = path.join(exported.root, `${String(project.name || 'project').replace(/[\\/:*?"<>|]/g, '_')}.electrical-v2.json`)
  const result = runBridgeExecutable(
    probe.bridgePath,
    ['--eplan', probe.eplanPath, '--input', input, '--output', bridgeOut, '--new-project-only', '--kill-eplan'],
    bridgeCwd,
  )
  const zw1 = fs.readdirSync(bridgeOut).find((name) => name.toLowerCase().endsWith('.zw1'))
  if (result.status !== 0 || !zw1) {
    fs.writeFileSync(path.join(exported.root, 'EPLAN_API_失败记录.txt'), `exit=${result.status}\r\n${result.stdout || ''}\r\n${result.stderr || ''}`, 'utf8')
    return { ...exported, ok: true, mode: 'task-pack', nativeEplanProjectGenerated: false, probe, note: 'EPLAN API 桥接未完成，已保留可人工导入的任务包。' }
  }
  return { ...exported, mode: 'official-api', nativeEplanProjectGenerated: true, zw1Path: path.join(bridgeOut, zw1), probe, note: '已由官方 API 桥接生成新的 EPLAN 工程备份；未覆盖原工程。' }
}

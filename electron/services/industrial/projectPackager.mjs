/**
 * IndustrialProject 磁盘包装：把域产物整理为可浏览工程树
 *
 * projDir/
 *   project.json
 *   mechanical/
 *   electrical/
 *   plc/
 *   manufacturing/
 *   reports/
 */
import fs from 'node:fs'
import path from 'node:path'

export const DOMAIN_FOLDERS = {
  cad: 'mechanical',
  electrical: 'electrical',
  plc: 'plc',
  cam: 'manufacturing',
}

/** artifact kind → 工程内友好文件名 */
const FRIENDLY_NAMES = {
  cad: {
    dxf: 'drawing.dxf',
    geometryJson: 'geometry.json',
  },
  electrical: {
    dxf: 'schematic.dxf',
    svg: 'schematic.svg',
    json: 'schematic.json',
    bom: 'bom.json',
  },
  plc: {
    ladderJson: 'ladder.json',
    ladderAscii: 'ladder.txt',
    mnemonic: 'mnemonic.txt',
    simReport: 'test-report.json',
  },
  cam: {
    nc: 'program.nc',
    toolpath: 'toolpath.json',
    safety: 'safety.json',
  },
}

function safeCopy(src, dest) {
  if (!src || typeof src !== 'string') return null
  if (!fs.existsSync(src)) return null
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  return dest
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8')
  return filePath
}

/**
 * @param {object} opts
 * @param {string} opts.projDir
 * @param {object} opts.pack - workflow pack (name, id, holdMs, description, ioTable, domains)
 * @param {object} opts.domainResults - tryCreateFromIr results by domain
 * @param {object|null} opts.sequence
 * @param {string} opts.reportMarkdown
 * @returns {{ projectJsonPath, reportPath, manifestPath, ioPath, packagedArtifacts, tree }}
 */
export function packIndustrialProject(opts = {}) {
  const projDir = opts.projDir
  if (!projDir) throw new Error('packIndustrialProject: projDir required')
  fs.mkdirSync(projDir, { recursive: true })

  for (const folder of Object.values(DOMAIN_FOLDERS)) {
    fs.mkdirSync(path.join(projDir, folder), { recursive: true })
  }
  fs.mkdirSync(path.join(projDir, 'reports'), { recursive: true })

  const pack = opts.pack || {}
  const domainResults = opts.domainResults || {}
  const packagedArtifacts = []
  const tree = {
    mechanical: [],
    electrical: [],
    plc: [],
    manufacturing: [],
    reports: [],
  }

  for (const [domain, result] of Object.entries(domainResults)) {
    const folder = DOMAIN_FOLDERS[domain]
    if (!folder) continue
    const art = result?.data?.artifact || {}
    const nameMap = FRIENDLY_NAMES[domain] || {}

    // IR dump
    const ir = pack.domains?.[domain]
    if (ir) {
      const irPath = path.join(projDir, folder, `${domain}.ir.json`)
      writeJson(irPath, ir)
      packagedArtifacts.push({ domain, kind: 'ir', path: irPath, folder })
      tree[folder].push(path.basename(irPath))
    }

    for (const [kind, src] of Object.entries(art)) {
      if (kind === 'format' || kind === 'vendor') continue
      if (typeof src !== 'string') continue
      const friendly = nameMap[kind] || `${kind}${path.extname(src) || ''}`
      const dest = path.join(projDir, folder, friendly)
      const copied = safeCopy(src, dest)
      if (copied) {
        packagedArtifacts.push({ domain, kind, path: copied, folder, source: src })
        tree[folder].push(friendly)
      }
    }
  }

  const reportPath = path.join(projDir, 'reports', 'design-report.md')
  fs.writeFileSync(reportPath, opts.reportMarkdown || '', 'utf8')
  tree.reports.push('design-report.md')

  const manifest = {
    workflow: pack.id,
    name: pack.name,
    holdMs: pack.holdMs,
    description: pack.description,
    ioTable: pack.ioTable,
    domains: Object.keys(domainResults),
    artifacts: packagedArtifacts.map(({ domain, kind, path: p, folder }) => ({
      domain,
      kind,
      path: p,
      folder,
    })),
    sequence: opts.sequence
      ? { ok: opts.sequence.ok, log: opts.sequence.log }
      : null,
    createdAt: new Date().toISOString(),
    layout: 'industrial-project-v1',
  }
  const manifestPath = writeJson(path.join(projDir, 'reports', 'manifest.json'), manifest)
  tree.reports.push('manifest.json')

  const ioPath = writeJson(path.join(projDir, 'reports', 'io_table.json'), {
    items: pack.ioTable || [],
  })
  // also electrical/io.json convenience copy
  const elecIo = path.join(projDir, 'electrical', 'io.json')
  writeJson(elecIo, { items: pack.ioTable || [] })
  tree.electrical.push('io.json')
  tree.reports.push('io_table.json')

  const projectMeta = {
    schemaVersion: 1,
    kind: 'industrial.project.disk',
    name: pack.name,
    workflow: pack.id,
    holdMs: pack.holdMs,
    description: pack.description || '',
    createdAt: manifest.createdAt,
    domains: Object.keys(domainResults),
    folders: ['mechanical', 'electrical', 'plc', 'manufacturing', 'reports'],
    tree,
    artifacts: packagedArtifacts,
    /** Phase A stub — Phase D 血缘/变更影响将扩展此字段 */
    versions: [
      {
        version: 1,
        label: 'v1',
        createdAt: manifest.createdAt,
        parents: [],
        domains: Object.keys(domainResults),
      },
    ],
    lineage: { parents: [], children: [] },
    reportPath,
    manifestPath,
    ioPath,
  }
  const projectJsonPath = writeJson(path.join(projDir, 'project.json'), projectMeta)
  packagedArtifacts.push(
    { domain: 'project', kind: 'projectJson', path: projectJsonPath, folder: '.' },
    { domain: 'project', kind: 'report', path: reportPath, folder: 'reports' },
    { domain: 'project', kind: 'manifest', path: manifestPath, folder: 'reports' },
    { domain: 'project', kind: 'ioTable', path: ioPath, folder: 'reports' },
  )

  return {
    projectJsonPath,
    reportPath,
    manifestPath,
    ioPath,
    packagedArtifacts,
    tree,
    projectMeta,
  }
}

/**
 * 扫描 projects 根目录，列出含 project.json 的工程
 */
export function listIndustrialProjects(projectsRoot) {
  const root = projectsRoot
  if (!root || !fs.existsSync(root)) return []
  const out = []
  let entries = []
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const dir = path.join(root, ent.name)
    const pj = path.join(dir, 'project.json')
    if (!fs.existsSync(pj)) continue
    try {
      const meta = JSON.parse(fs.readFileSync(pj, 'utf8'))
      out.push({
        id: ent.name,
        name: meta.name || ent.name,
        workflow: meta.workflow || '',
        createdAt: meta.createdAt || '',
        projectDir: dir,
        reportPath: meta.reportPath || path.join(dir, 'reports', 'design-report.md'),
        domains: meta.domains || [],
        folders: meta.folders || [],
      })
    } catch {
      out.push({
        id: ent.name,
        name: ent.name,
        projectDir: dir,
        createdAt: '',
      })
    }
  }
  out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  return out
}

export function resolveProjectsRoot(explicit = '') {
  if (explicit) {
    const p = path.resolve(explicit)
    fs.mkdirSync(p, { recursive: true })
    return p
  }
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron')
    if (app?.getPath) {
      const dir = path.join(app.getPath('userData'), 'sama-data', 'workspace', 'projects')
      fs.mkdirSync(dir, { recursive: true })
      return dir
    }
  } catch {
    /* node */
  }
  const dir = path.join(process.cwd(), 'workspace', 'projects')
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

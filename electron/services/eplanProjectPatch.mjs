/**
 * EPLAN 工程改图（诚实边界）：
 * - 可：修复 .elk → .edb 链接、写入改图任务包、更新 ProjectInfo.xml 元数据（带备份）
 * - 不可：直接改 .slk 二进制库、绕过许可、无 API 时改原理图页
 */
import fs from 'node:fs'
import path from 'node:path'

function resolveElkPath(elkPath = '') {
  const raw = String(elkPath || '').trim().replace(/^["']|["']$/g, '')
  if (!raw) return { ok: false, error: '缺少 elkPath' }
  const abs = path.resolve(raw)
  if (fs.existsSync(abs) && /\.elk$/i.test(abs)) return { ok: true, path: abs }
  return { ok: false, error: `找不到 .elk：${abs}` }
}

function elkDir(elkPath) {
  return path.dirname(path.resolve(elkPath))
}

function readElk(elkPath) {
  const buf = fs.readFileSync(elkPath)
  let raw
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    raw = buf.toString('utf16le').replace(/^\uFEFF/, '')
  } else if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    raw = buf.swap16().toString('utf16le').replace(/^\uFEFF/, '')
  } else {
    raw = buf.toString('utf8').replace(/^\uFEFF/, '')
  }
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/\0/g, '').trim()).filter(Boolean)
  return { edbName: lines[0] || '', version: lines[1] || '13.0', raw }
}

function writeElk(elkPath, edbName, version = '13.0') {
  fs.writeFileSync(elkPath, `${edbName}\n${version}\n`, 'utf8')
}

function findEdbFolder(elkPath) {
  const dir = elkDir(elkPath)
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  const folders = entries
    .filter((e) => e.isDirectory() && /\.edb$/i.test(e.name))
    .map((e) => path.join(dir, e.name))
  if (!folders.length) return ''
  const projectInfo = folders.find((f) => fs.existsSync(path.join(f, 'ProjectInfo.xml')))
  return projectInfo || folders[0]
}

export function resolveEplanProject(elkPath = '') {
  const resolved = resolveElkPath(elkPath)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  const elk = resolved.path
  const { edbName, version } = readElk(elk)
  const edbFolder = path.join(elkDir(elk), edbName)
  const edbExists = fs.existsSync(edbFolder) && fs.statSync(edbFolder).isDirectory()
  const candidate = findEdbFolder(elk)
  const linkBroken = !edbExists && candidate
  return {
    ok: true,
    elkPath: elk,
    elkDir: elkDir(elk),
    edbName,
    edbFolder,
    edbExists,
    linkBroken,
    suggestedEdbName: candidate ? path.basename(candidate) : '',
    suggestedEdbFolder: candidate || '',
    eplanVersionLine: version,
    projectInfoPath: edbExists ? path.join(edbFolder, 'ProjectInfo.xml') : candidate ? path.join(candidate, 'ProjectInfo.xml') : '',
  }
}

export function repairElkLink(elkPath = '') {
  const info = resolveEplanProject(elkPath)
  if (!info.ok) return info
  if (info.edbExists) {
    return { ok: true, repaired: false, elkPath: info.elkPath, edbFolder: info.edbFolder, note: '.elk 链接正常' }
  }
  if (!info.suggestedEdbName) {
    return { ok: false, error: '找不到同级 .edb 目录，无法修复 .elk 链接', elkPath: info.elkPath }
  }
  const before = readElk(info.elkPath)
  writeElk(info.elkPath, info.suggestedEdbName, before.version || '13.0')
  return {
    ok: true,
    repaired: true,
    elkPath: info.elkPath,
    beforeEdb: before.edbName,
    afterEdb: info.suggestedEdbName,
    edbFolder: info.suggestedEdbFolder,
    note: `已修复 .elk：${before.edbName} → ${info.suggestedEdbName}`,
  }
}

function patchProjectInfoXml(xmlPath, { descriptionSuffix = '' } = {}) {
  if (!xmlPath || !fs.existsSync(xmlPath)) {
    return { ok: false, error: `ProjectInfo.xml 不存在：${xmlPath}` }
  }
  const backup = `${xmlPath}.sama-backup-${Date.now()}.xml`
  fs.copyFileSync(xmlPath, backup)
  let xml = fs.readFileSync(xmlPath, 'utf8')
  const suffix = String(descriptionSuffix || '').trim()
  if (!suffix) return { ok: false, error: '缺少 descriptionSuffix' }

  const descRe = /(<Property name="项目描述" id="10011" index="0" type="15">)([\s\S]*?)(<\/Property>)/i
  const m = xml.match(descRe)
  if (!m) return { ok: false, error: 'ProjectInfo.xml 中未找到项目描述字段', backup }

  const oldDesc = m[2]
  const marker = ' | SAMA:'
  const base = oldDesc.includes(marker) ? oldDesc.split(marker)[0] : oldDesc
  const newDesc = `${base}${marker}${suffix}`
  xml = xml.replace(descRe, `$1${newDesc}$3`)

  const now = Math.floor(Date.now() / 1000)
  xml = xml.replace(
    /(<Property name="更改日期" id="10023" index="0" type="14">)(\d+)(<\/Property>)/i,
    `$1${now}$3`,
  )

  fs.writeFileSync(xmlPath, xml, 'utf8')
  return {
    ok: true,
    backup,
    projectInfoPath: xmlPath,
    descriptionBefore: oldDesc,
    descriptionAfter: newDesc,
    changedAt: now,
  }
}

function writePatchPack(projectDir, payload) {
  const root = path.join(projectDir, 'SAMA_patches', String(Date.now()))
  fs.mkdirSync(root, { recursive: true })
  const manifest = {
    format: 'SAMA-EPLAN-PROJECT-PATCH',
    version: 1,
    generatedAt: new Date().toISOString(),
    nativeSchematicModified: false,
    note: '仅元数据/任务包级改图；原理图页未通过 API 改写。',
    ...payload,
  }
  fs.writeFileSync(path.join(root, 'patch.json'), JSON.stringify(manifest, null, 2), 'utf8')
  fs.writeFileSync(
    path.join(root, 'EPLAN改图说明.txt'),
    [
      'SAMA EPLAN 改图任务包',
      '',
      `工程：${payload.elkPath || ''}`,
      `补丁：${payload.patch?.descriptionSuffix || ''}`,
      '',
      '已在 ProjectInfo.xml 写入 SAMA 修订标记（已备份原文件）。',
      '原理图位号/连线需在 EPLAN 许可通过后用官方界面或 API 桥接完成。',
      '',
      `生成时间：${manifest.generatedAt}`,
    ].join('\r\n'),
    'utf8',
  )
  return root
}

/**
 * 对已有 EPLAN 工程应用「可安全自动化」的改图：修链 + 元数据补丁 + 任务包。
 */
export function patchEplanProject(elkPath = '', patch = {}) {
  const repair = repairElkLink(elkPath)
  if (!repair.ok) return { ok: false, action: 'patchProject', ...repair }

  const info = resolveEplanProject(repair.elkPath)
  if (!info.ok || !info.edbExists) {
    return { ok: false, action: 'patchProject', error: '修复后仍找不到 .edb 目录', info }
  }

  const suffix = String(patch.descriptionSuffix || patch.note || '改图测试').trim()
  const meta = patchProjectInfoXml(info.projectInfoPath, { descriptionSuffix: suffix })
  if (!meta.ok) {
    return { ok: false, action: 'patchProject', repair, meta, error: meta.error }
  }

  const packRoot = writePatchPack(info.elkDir, {
    elkPath: info.elkPath,
    edbFolder: info.edbFolder,
    patch: { descriptionSuffix: suffix, ...patch },
    meta,
    repair,
  })

  return {
    ok: true,
    action: 'patchProject',
    elkPath: info.elkPath,
    edbFolder: info.edbFolder,
    repair,
    meta,
    packRoot,
    nativeSchematicModified: false,
    note: `已修复链接（若需要）、更新项目描述并生成改图任务包：${packRoot}`,
  }
}

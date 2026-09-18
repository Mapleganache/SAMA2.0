/**
 * 内置 LAD 资源路径（随 electron/ 打包进 asar）
 * Fladder 不能直接打开 asar 内路径，使用前须 materializeBuiltinLad 拷到临时/目标处。
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** 开发：electron/resources/lad；打包 asar 内同相对路径 */
export function getBuiltinLadDir() {
  try {
    // electron-builder extraResources → resources/lad
    const rp = process.resourcesPath
    if (rp) {
      const packed = path.join(rp, 'lad')
      if (fs.existsSync(packed)) return packed
    }
  } catch {
    /* ignore */
  }
  return path.join(__dirname, '..', 'resources', 'lad')
}

export const BUILTIN_EMPTY_SHELL = 'empty_0i_shell.LAD'
export const BUILTIN_FORMAT_STANDARD = 'format_standard_studer.LAD'
export const BUILTIN_MANIFEST = 'manifest.json'

export function builtinLadPath(name) {
  return path.join(getBuiltinLadDir(), name)
}

export function listBuiltinLads() {
  const dir = getBuiltinLadDir()
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((n) => /\.lad$/i.test(n))
    .map((n) => ({
      name: n,
      path: path.join(dir, n),
      bytes: fs.statSync(path.join(dir, n)).size,
    }))
}

/**
 * 把 asar/仓库内的内置 LAD 拷到可写路径（Fladder 可打开）
 */
export function materializeBuiltinLad(name, destPath = '') {
  const src = builtinLadPath(name)
  if (!fs.existsSync(src)) {
    return { ok: false, error: `内置 LAD 不存在：${name}` }
  }
  const dest =
    destPath ||
    path.join(os.tmpdir(), `sama-builtin-${path.basename(name).replace(/[^\w.-]+/g, '_')}`)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.copyFileSync(src, dest)
  try {
    fs.chmodSync(dest, 0o666)
  } catch {
    /* ignore */
  }
  return { ok: true, path: dest, source: src, bytes: fs.statSync(dest).size }
}

export function readBuiltinManifest() {
  const p = builtinLadPath(BUILTIN_MANIFEST)
  if (!fs.existsSync(p)) return null
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return null
  }
}

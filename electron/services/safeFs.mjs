import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { app } from 'electron'
import { ensureDir, getDataRoot } from './paths.mjs'
import { decodeTextBuffer, writeUtf8Text } from './textEncoding.mjs'

export const MAX_BYTES = 2 * 1024 * 1024 // 2MB（FANUC 画面 XML 常较大）

export const ALLOWED_EXT = new Set([
  '.nc',
  '.cnc',
  '.txt',
  '.md',
  '.xml',
  '.json',
  '.csv',
  '.ini',
  '.ls',
  '.mpf',
  '.spf',
  '.src',
  '.sub',
  '.prg',
  '.gcode',
  '.tap',
  '.iso',
  '.ngc',
  '.svg',
  '.html',
  '.pdf',
  '.dxf',
  '.h',
  '.def',
  '.fp',
  '.fp2',
  '.fpp',
  '.lad',
  '.apk',
  '.log',
])

const BLOCKED_ABS_PREFIXES = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData',
  'C:\\System Volume Information',
  'C:\\$Recycle.Bin',
  'C:\\Recovery',
  'C:\\Boot',
  'C:\\Users\\Default',
]

const BLOCKED_NAMES = new Set([
  'desktop.ini',
  'thumbs.db',
  'autorun.inf',
  'ntuser.dat',
  'pagefile.sys',
  'hiberfil.sys',
])

export function deny(msg, code = 'FS_DENIED') {
  const err = new Error(msg)
  err.code = code
  return err
}

export function getAllowedRoots() {
  const roots = []
  try {
    roots.push(app.getPath('desktop'))
    roots.push(app.getPath('documents'))
    roots.push(app.getPath('downloads'))
  } catch {
    const home = os.homedir()
    roots.push(path.join(home, 'Desktop'))
    roots.push(path.join(home, 'Documents'))
    roots.push(path.join(home, 'Downloads'))
  }
  roots.push(path.join(getDataRoot(), 'workspace'))
  return [...new Set(roots.map((r) => path.resolve(r)))]
}

export function isUnder(parent, child) {
  const p = path.resolve(parent).toLowerCase()
  const c = path.resolve(child).toLowerCase()
  return c === p || c.startsWith(p + path.sep.toLowerCase()) || c.startsWith(p + '\\') || c.startsWith(p + '/')
}

export function looksAbsolute(p) {
  const s = String(p || '').trim()
  return path.isAbsolute(s) || /^[a-zA-Z]:[\\/]/.test(s) || s.startsWith('\\\\')
}

export function normalizeAbs(p) {
  return path.resolve(String(p).trim().replace(/\//g, path.sep))
}

export function assertNotBlockedAbs(abs) {
  const lower = abs.toLowerCase()
  for (const prefix of BLOCKED_ABS_PREFIXES) {
    if (lower.startsWith(prefix.toLowerCase())) {
      throw deny(`禁止访问系统目录: ${prefix}`)
    }
  }
  const base = path.basename(abs).toLowerCase()
  if (BLOCKED_NAMES.has(base)) throw deny(`禁止操作系统保留文件: ${base}`)
  // 禁止写入用户配置核心目录（除 sama-data）
  const appData = (process.env.APPDATA || '').toLowerCase()
  if (appData && lower.startsWith(appData)) {
    const sama = path.join(getDataRoot()).toLowerCase()
    if (!lower.startsWith(sama)) {
      throw deny('禁止写入 AppData（除 SAMA 数据目录外）')
    }
  }
}

/**
 * 绝对路径是否允许读/写：桌面/文档/下载/工程沙箱，或可信路径（用户打开/拖入过）。
 */
export function assertAllowedUserAbs(abs, trustedPaths = []) {
  assertNotBlockedAbs(abs)
  const roots = getAllowedRoots()
  if (roots.some((r) => isUnder(r, abs))) return 'root'

  const trusted = (trustedPaths || [])
    .filter(Boolean)
    .map((p) => {
      try {
        return normalizeAbs(p)
      } catch {
        return null
      }
    })
    .filter(Boolean)

  if (trusted.some((t) => abs.toLowerCase() === t.toLowerCase() || isUnder(path.dirname(t), abs))) {
    return 'trusted'
  }

  throw deny(
    `路径不在允许范围（桌面/文档/下载/工程沙箱，或你已打开过的文件目录）：${abs}`,
  )
}

export function isFanucOFileName(filePath) {
  const base = path.basename(String(filePath || ''))
  return /^O\d{1,8}$/i.test(base)
}

export function assertAllowedExt(abs) {
  const ext = path.extname(abs).toLowerCase()
  if (!ext && isFanucOFileName(abs)) return
  if (!ALLOWED_EXT.has(ext)) {
    throw deny(`不允许的文件类型: ${ext || '(无扩展名)'}。仅允许工程文本/程序文件`)
  }
}

export function detectTextEncoding(abs) {
  if (!fs.existsSync(abs)) return 'utf8'
  const buf = fs.readFileSync(abs)
  const head = buf.subarray(0, Math.min(buf.length, 4))
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0xfe) return 'utf16le'
  if (head.length >= 2 && head[0] === 0xfe && head[1] === 0xff) return 'utf16be'
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf8-bom'
  const { encoding } = decodeTextBuffer(buf)
  if (encoding === 'utf16le') return 'utf16le'
  if (encoding.startsWith('gb') || encoding === 'shift_jis') return encoding
  return 'utf8'
}

export function readTextFile(abs, maxBytes = MAX_BYTES) {
  const st = fs.statSync(abs)
  if (!st.isFile()) throw deny('不是文件')
  if (st.size > maxBytes) throw deny(`文件过大（>${maxBytes} 字节）`)
  const buf = fs.readFileSync(abs)
  const { text, encoding } = decodeTextBuffer(buf)
  // 写回时：GBK 源文件在中文环境下仍可写回 GBK；其它统一 UTF-8（带 BOM）
  const writeEnc =
    encoding === 'utf16le'
      ? 'utf16le'
      : encoding.startsWith('gb') || encoding === 'shift_jis'
        ? encoding
        : encoding === 'utf8-bom'
          ? 'utf8-bom'
          : 'utf8'
  return { content: text, encoding: writeEnc }
}

export function writeTextFile(abs, content, encoding = 'utf8') {
  ensureDir(path.dirname(abs))
  const body = String(content).replace(/^\uFEFF/, '')
  if (encoding === 'utf16le') {
    fs.writeFileSync(abs, `\uFEFF${body}`, 'utf16le')
    return
  }
  // GBK/Shift_JIS 源文件：SAMA 统一写回 UTF-8 BOM（记事本/多数编辑器中文不乱码）
  // 避免无 BOM UTF-8 在中文 Windows 被当成系统 ANSI 打开
  writeUtf8Text(abs, body, { bom: true })
}

export function extractLikelyFilePaths(text) {
  if (!text) return []
  const re =
    /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]+\.[A-Za-z0-9]{1,8}/g
  const hits = text.match(re) || []
  const re2 =
    /[A-Za-z]:\/(?:[^\\/:*?"<>|\r\n]+\/)*[^\\/:*?"<>|\r\n]+\.[A-Za-z0-9]{1,8}/g
  const hits2 = (text.match(re2) || []).map((p) => p.replace(/\//g, '\\'))
  return [...new Set([...hits, ...hits2])]
}

/** 提取可能的目录路径（无扩展名），用于 FANUC PICTURE 工程文件夹 */
export function extractLikelyDirPaths(text) {
  if (!text) return []
  const re =
    /[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n.]+/g
  const hits = text.match(re) || []
  // 去掉其实是文件的
  return [...new Set(hits.filter((p) => !/\.[A-Za-z0-9]{1,8}$/.test(p)))]
}

/**
 * 把用户给的路径（文件或目录）解析成可读工程文件列表。
 * 目录时优先 FPicture1.xml，其次任意 FPicture*.xml / *.xml
 */
export function resolveProjectFiles(pathOrDir, { trustedPaths = [] } = {}) {
  const abs = normalizeAbs(pathOrDir)
  assertAllowedUserAbs(abs, trustedPaths)
  const out = []

  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    out.push(abs)
    return out
  }

  if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    assertAllowedUserAbs(abs, trustedPaths)
    const names = fs.readdirSync(abs)
    const prefer = ['FPicture1.xml', 'FPicture1-1.xml', 'MAIN.xml', '_MENU.Xml', '_MENU.xml']
    for (const n of prefer) {
      const hit = names.find((x) => x.toLowerCase() === n.toLowerCase())
      if (hit) out.push(path.join(abs, hit))
    }
    if (!out.length) {
      for (const n of names) {
        if (/^FPicture.*\.xml$/i.test(n) || /\.xml$/i.test(n)) {
          out.push(path.join(abs, n))
          if (out.length >= 3) break
        }
      }
    }
    // 附带工程索引 .fp2（小文本）
    for (const n of names) {
      if (/\.fp2$/i.test(n)) {
        out.push(path.join(abs, n))
        break
      }
    }
  }
  return out
}

/** 假 FANUC PICTURE 片段：模型常编造的非法格式 */
export function looksLikeFakeFanucPicture(content) {
  const s = String(content || '')
  if (/<FANUCPicture[\s>]/i.test(s) && /<FP[A-Za-z]+[\s>]/i.test(s)) return false
  // 典型胡编标签
  if (/<FPScreen[\s>]/i.test(s) || /<FPLabel[\s>]/i.test(s) || /<FPInit[\s>]/i.test(s)) {
    return true
  }
  if (/<FPButton[\s>][\s\S]*<Action>/i.test(s) && !/<FANUCPicture/i.test(s)) {
    return true
  }
  return false
}


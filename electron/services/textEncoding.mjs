/**
 * 中文 Windows / FANUC 文本常见编码：UTF-8、GBK/GB18030、UTF-16、Shift_JIS
 * 注意：合法 UTF-8 中文被当 GBK 解也会「读出」一堆汉字，纯按汉字计数会误判。
 */
import fs from 'node:fs'
import path from 'node:path'

const DECODER_CANDIDATES = ['utf-8', 'gb18030', 'gbk', 'shift_jis', 'windows-1252']

function countRe(s, re) {
  return (String(s).match(re) || []).length
}

/** 缓冲区是否为合法 UTF-8（无非法序列、无过度编码） */
export function isValidUtf8(buf) {
  if (!buf || !buf.length) return true
  try {
    const dec = new TextDecoder('utf-8', { fatal: true })
    dec.decode(buf)
    return true
  } catch {
    return false
  }
}

/** 越高越好 */
export function scoreDecodedText(text) {
  const s = String(text || '')
  if (!s) return -1e9
  const fffd = countRe(s, /\uFFFD/g)
  const cjk = countRe(s, /[\u4e00-\u9fff]/g)
  const kana = countRe(s, /[\u3040-\u30ff]/g)
  // UTF-8 被当 Latin1/GBK 误读时的典型碎片
  const mojibake = countRe(s, /Ã.|Â.|Ä.|Å.|Æ.|Ç.|È.|É.|Ô.|ã.|ä.|å./g)
  const ctrl = countRe(s, /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g)
  // UTF-8→GBK 误读常见怪字（如「鍦嗗舰杞」相对「圆形轮」）
  const suspicious = countRe(s, /[鍦嗗舰杞粨鉚嘚]/g)
  return (
    cjk * 12 +
    kana * 8 -
    fffd * 80 -
    mojibake * 25 -
    suspicious * 40 -
    ctrl * 40 +
    Math.min(s.length, 200) * 0.01
  )
}

export function decodeTextBuffer(buf, { prefer = [] } = {}) {
  if (!buf || !buf.length) return { text: '', encoding: 'utf8' }

  // BOM
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return { text: buf.toString('utf16le').replace(/^\uFEFF/, '').replace(/\0+$/g, ''), encoding: 'utf16le' }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.alloc(buf.length - 2)
    for (let i = 2; i + 1 < buf.length; i += 2) {
      swapped[i - 2] = buf[i + 1]
      swapped[i - 1] = buf[i]
    }
    return { text: swapped.toString('utf16le').replace(/^\uFEFF/, ''), encoding: 'utf16le' }
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.slice(3).toString('utf8'), encoding: 'utf8-bom' }
  }

  // 合法 UTF-8：默认按 UTF-8（避免「圆形」被误读成「鍦嗗舰…」）
  // 仅当调用方明确 prefer GB 系，且 UTF-8 几乎无汉字、GB 得分明显更高时才改判
  if (isValidUtf8(buf)) {
    const utf8 = buf.toString('utf8').replace(/\0+/g, '').replace(/^\uFEFF/, '')
    const preferGb = prefer.some((p) => /gb|shift_jis/i.test(String(p)))
    if (!preferGb) {
      return { text: utf8, encoding: 'utf8' }
    }
    const utfScore = scoreDecodedText(utf8)
    let gbBest = null
    for (const label of ['gb18030', 'gbk']) {
      try {
        const text = new TextDecoder(label, { fatal: false }).decode(buf).replace(/\0+/g, '')
        const score = scoreDecodedText(text)
        if (!gbBest || score > gbBest.score) gbBest = { text, encoding: label, score }
      } catch {
        /* ignore */
      }
    }
    if (gbBest && gbBest.score > utfScore + 40 && countRe(utf8, /[\u4e00-\u9fff]/g) === 0) {
      return { text: gbBest.text, encoding: gbBest.encoding }
    }
    return { text: utf8, encoding: 'utf8' }
  }

  const tried = [...prefer, ...DECODER_CANDIDATES]
  const seen = new Set()
  let best = { text: buf.toString('latin1'), encoding: 'latin1', score: -1e9 }

  for (const label of tried) {
    const key = String(label).toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    try {
      let text
      if (key === 'utf-8' || key === 'utf8') {
        text = buf.toString('utf8')
      } else if (key === 'latin1' || key === 'binary') {
        text = buf.toString('latin1')
      } else {
        text = new TextDecoder(key, { fatal: false }).decode(buf)
      }
      text = text.replace(/\0+/g, '').replace(/^\uFEFF/, '')
      const score = scoreDecodedText(text)
      if (score > best.score) {
        best = {
          text,
          encoding: key === 'utf-8' ? 'utf8' : key,
          score,
        }
      }
    } catch {
      /* ignore unsupported */
    }
  }

  // 几乎全是 ASCII：优先 utf8
  if (!/[^\x00-\x7F]/.test(best.text) || (best.score < 0 && !countRe(best.text, /[\u4e00-\u9fff]/g))) {
    const utf8 = buf.toString('utf8').replace(/\0+/g, '')
    if (countRe(utf8, /\uFFFD/g) === 0) {
      return { text: utf8, encoding: 'utf8' }
    }
  }

  return { text: best.text, encoding: best.encoding }
}

export function readTextAuto(abs, maxBytes = 8 * 1024 * 1024) {
  const st = fs.statSync(abs)
  if (!st.isFile()) throw new Error('不是文件')
  if (st.size > maxBytes) throw new Error(`文件过大（>${maxBytes} 字节）`)
  const buf = fs.readFileSync(abs)
  return decodeTextBuffer(buf)
}

/** Windows 下 Markdown/文本：写 UTF-8 BOM，避免记事本按系统 ANSI(GBK) 打开乱码 */
export function shouldWriteUtf8Bom(filePath, _content) {
  if (process.platform !== 'win32') return false
  const ext = path.extname(String(filePath || '')).toLowerCase()
  return ['.md', '.txt', '.csv', '.log', '.ini', '.json', '.xml'].includes(ext)
}

export function writeUtf8Text(abs, content, { bom = 'auto' } = {}) {
  const body = String(content).replace(/^\uFEFF/, '')
  const useBom = bom === true || (bom === 'auto' && shouldWriteUtf8Bom(abs, body))
  if (useBom) {
    fs.writeFileSync(abs, `\uFEFF${body}`, 'utf8')
    return { encoding: 'utf8-bom', bytes: Buffer.byteLength(body, 'utf8') + 3 }
  }
  fs.writeFileSync(abs, body, 'utf8')
  return { encoding: 'utf8', bytes: Buffer.byteLength(body, 'utf8') }
}

/** 清理已误读进字符串的「年/月/日」等常见乱码（兜底） */
export function repairCommonMojibake(text) {
  let s = String(text || '')
  // GBK「年月日」被当成 Latin1/Windows-1252
  s = s.replace(/Äê/g, '年').replace(/ÔÂ/g, '月').replace(/ÈÕ/g, '日')
  // UTF-8 年(E5 B9 B4) 被当 Latin1 再显示
  s = s.replace(/Ã¥Â¹Â´/g, '年').replace(/Ã¦ÂÂ/g, '月').replace(/Ã¦ÂÂ¥/g, '日')
  return s
}

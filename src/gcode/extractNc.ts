/** 从助手回复里抽出 G 代码围栏或像 NC 的代码块 */

const TAGGED =
  /```(?:g-?code|nc|cnc|fanuc|mpf|siemens|iso|num|ngc|tap)\s*\r?\n([\s\S]*?)```/gi

function looksLikeNc(body: string): boolean {
  const s = String(body || '')
  if (/<svg[\s>]/i.test(s)) return false
  return (
    /^\s*O\d+/im.test(s) ||
    /%_N_[A-Z0-9_]+_MPF/i.test(s) ||
    /\bG0*[0-3]\b/i.test(s) ||
    /\bM0*30\b/i.test(s) ||
    /#\d+\s*=/.test(s) ||
    /\bCYCLE407/i.test(s) ||
    /\bG75\b|\bG78\b|\bG200\b/i.test(s)
  )
}

function lineCount(s: string) {
  return String(s || '').split(/\r?\n/).length
}

function extractUnfencedNc(src: string): string {
  const cleaned = String(src || '').replace(/```[\s\S]*?```/g, '\n')
  const o = cleaned.match(/(?:^|\n)(\s*O\d+[\s\S]*?\bM0*30\b[^\n]*)/i)
  if (o?.[1] && looksLikeNc(o[1]) && lineCount(o[1]) >= 4) return o[1].trim()
  const mpf = cleaned.match(/(%_N_[A-Z0-9_]+_MPF[\s\S]*?\bM0*30\b)/i)
  if (mpf?.[1] && looksLikeNc(mpf[1])) return mpf[1].trim()
  return ''
}

export function extractNcFromAssistant(text: string): string {
  const src = String(text || '')
  TAGGED.lastIndex = 0
  let tagged
  while ((tagged = TAGGED.exec(src))) {
    if (tagged[1] && looksLikeNc(tagged[1])) return tagged[1].trim()
  }
  const re = /```[ \t]*\r?\n([\s\S]*?)```/g
  let m
  while ((m = re.exec(src))) {
    const body = m[1] || ''
    if (looksLikeNc(body)) return body.trim()
  }
  return extractUnfencedNc(src)
}

export function messageHasGcode(text: string): boolean {
  return Boolean(extractNcFromAssistant(text))
}

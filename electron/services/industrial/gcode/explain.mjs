/**
 * G-code 逐行解释（教学/分析）
 */
import { parseGcodeText } from './gcodeParser.mjs'

const CYCLE_HINT = {
  G81: '钻孔循环：一次进给到深度后快速退刀。',
  G82: '钻孔循环（带暂停）：适合沉头/锪孔。',
  G83: '深孔钻削：按 Q 分步进给并退刀，利于排屑。',
  G84: '攻丝循环：主轴与进给联动攻螺纹。',
}

function fmtAxis(words) {
  const parts = []
  for (const k of ['X', 'Y', 'Z', 'I', 'J', 'K', 'R', 'Q', 'P', 'F', 'S', 'H', 'D', 'T']) {
    if (words[k] != null) parts.push(`${k}=${words[k]}`)
  }
  return parts
}

export function explainNcLine(rawLine, modalHint = {}) {
  const text = String(rawLine || '').trim()
  if (!text || text === '%' || text.startsWith('(') || text.startsWith(';') || text.startsWith('O')) {
    let summary = '注释或空行'
    if (text === '%') summary = '程序起止符'
    else if (/^O\d+/i.test(text)) summary = `程序号 ${text}`
    else if (text.startsWith('(') || text.startsWith(';')) summary = '注释'
    return { kind: 'skip', title: summary, summary, raw: text, detail: [] }
  }

  const g = [...text.matchAll(/\bG(\d+)/gi)].map((m) => `G${String(Number(m[1])).padStart(2, '0')}`)
  const mCodes = [...text.matchAll(/\bM(\d+)/gi)].map((m) => `M${String(Number(m[1])).padStart(2, '0')}`)
  const words = {}
  for (const m of text.matchAll(/([XYZFIJKRPQHSTDF])\s*([-+]?\d*\.?\d+)/gi)) {
    words[m[1].toUpperCase()] = Number(m[2])
  }

  let title = ''
  const detail = []

  // 一行多个准备码：汇总，避免只显示其中一个
  const setupGs = g.filter((x) =>
    ['G21', 'G20', 'G90', 'G91', 'G54', 'G55', 'G56', 'G57', 'G17', 'G18', 'G19', 'G40', 'G49', 'G80', 'G98', 'G99'].includes(x),
  )
  if (setupGs.length >= 2 && !g.some((x) => ['G00', 'G01', 'G02', 'G03', 'G81', 'G83', 'G84', 'G43', 'G41', 'G42'].includes(x))) {
    title = `准备指令 ${setupGs.join(' ')}`
  } else if (g.includes('G83')) {
    title = '深孔钻削 (G83)'
    detail.push(CYCLE_HINT.G83)
  } else if (g.includes('G81')) {
    title = '钻孔循环 (G81)'
    detail.push(CYCLE_HINT.G81)
  } else if (g.includes('G84')) {
    title = '攻丝循环 (G84)'
    detail.push(CYCLE_HINT.G84)
  } else if (g.includes('G80')) {
    title = '取消固定循环 (G80)'
  } else if (g.includes('G00') || (!g.length && modalHint.motion === 'G00' && (words.X != null || words.Y != null || words.Z != null))) {
    title = '快速定位 (G00)'
  } else if (g.includes('G01') || (!g.length && modalHint.motion === 'G01' && (words.X != null || words.Y != null || words.Z != null))) {
    title = '直线切削 (G01)'
  } else if (g.includes('G02')) {
    title = '顺圆弧 (G02)'
  } else if (g.includes('G03')) {
    title = '逆圆弧 (G03)'
  } else if (g.includes('G43')) {
    title = '刀长补偿接通 (G43)'
  } else if (g.includes('G49')) {
    title = '取消刀长补偿 (G49)'
  } else if (g.includes('G41') || g.includes('G42')) {
    title = g.includes('G41') ? '刀径左补偿 (G41)' : '刀径右补偿 (G42)'
  } else if (g.includes('G40')) {
    title = '取消刀径补偿 (G40)'
  } else if (g.includes('G21')) {
    title = '公制单位 (G21)'
  } else if (g.includes('G20')) {
    title = '英制单位 (G20)'
  } else if (g.includes('G90')) {
    title = '绝对坐标 (G90)'
  } else if (g.includes('G91')) {
    title = '增量坐标 (G91)'
  } else if (g.includes('G54') || g.includes('G55') || g.includes('G56') || g.includes('G57')) {
    title = `工件坐标系 (${g.find((x) => /^G5[4-9]$/.test(x)) || 'G54'})`
  } else if (g.includes('G17')) {
    title = 'XY 平面 (G17)'
  } else if (g.includes('G98')) {
    title = '循环退刀到初始平面 (G98)'
  } else if (g.includes('G99')) {
    title = '循环退刀到 R 平面 (G99)'
  }

  if (mCodes.includes('M06') || (/T\d+/i.test(text) && mCodes.includes('M06'))) {
    title = title ? `${title} · 换刀` : '换刀 (M06)'
  } else if (/^T\d+/i.test(text) && !title) {
    title = `选刀 ${text.match(/T\d+/i)?.[0]}`
  }
  if (mCodes.includes('M03')) title = title ? `${title} · 主轴正转` : '主轴正转 (M03)'
  if (mCodes.includes('M04')) title = title ? `${title} · 主轴反转` : '主轴反转 (M04)'
  if (mCodes.includes('M05')) title = title ? `${title} · 主轴停` : '主轴停止 (M05)'
  if (mCodes.includes('M08')) title = title ? `${title} · 冷却开` : '冷却液开 (M08)'
  if (mCodes.includes('M09')) title = title ? `${title} · 冷却关` : '冷却液关 (M09)'
  if (mCodes.includes('M30')) title = '程序结束并复位 (M30)'
  if (mCodes.includes('M02')) title = '程序结束 (M02)'

  // 多模态一行：如 G90 G54 G17 G40…
  if (!title && g.length) {
    title = `准备指令 ${g.join(' ')}`
  }
  if (!title && mCodes.length) {
    title = `辅助功能 ${mCodes.join(' ')}`
  }
  if (!title && (words.X != null || words.Y != null || words.Z != null)) {
    const motion = modalHint.motion || 'G01'
    title = motion === 'G00' ? '快速定位 (模态 G00)' : `直线切削 (模态 ${motion})`
  }
  if (!title) title = '程序行'

  detail.push(...fmtAxis(words))

  return {
    kind: 'explain',
    title,
    summary: detail.length ? `${title}：${detail.join('，')}` : title,
    detail,
    g,
    mCodes,
    words,
    raw: text,
  }
}

export function explainNcProgram(ncText) {
  const parsed = parseGcodeText(ncText)
  const lines = []
  for (const l of parsed.lines || []) {
    // 仍解释注释/程序号，便于对照；空行跳过
    if (!String(l.raw || '').trim()) continue
    const ex = explainNcLine(l.raw, l.modal)
    if (ex.kind === 'skip' && (!ex.raw || ex.raw === '')) continue
    lines.push({
      line: l.index,
      ...ex,
    })
  }
  return {
    ok: true,
    programNumber: parsed.programNumber,
    lines,
    summary: parsed.summary,
  }
}

/**
 * 生成带中文括号注释的 G 代码副本（不改原文件）。
 * 已有行尾注释的行不再重复追加。
 */
export function annotateNcProgramText(ncText) {
  const text = String(ncText || '').replace(/\r\n/g, '\n')
  const parsed = parseGcodeText(text)
  const byIndex = new Map()
  for (const l of parsed.lines || []) {
    byIndex.set(l.index, l)
  }

  const rawLines = text.split('\n')
  const out = []
  out.push('(SAMA 注释副本 — 仅供阅读学习，下机床前请人工核对)')

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]
    const trimmed = raw.trim()
    if (!trimmed) {
      out.push('')
      continue
    }
    if (trimmed === '%' || trimmed.startsWith('(') || trimmed.startsWith(';') || /^O\d+/i.test(trimmed)) {
      out.push(raw)
      continue
    }
    // 已有行尾注释则保留原样
    if (/\([^)]*\)\s*$/.test(trimmed) || /;/.test(trimmed)) {
      out.push(raw)
      continue
    }

    const parsedLine = byIndex.get(i) || { raw, modal: {} }
    const ex = explainNcLine(trimmed, parsedLine.modal || {})
    const note = String(ex.title || ex.summary || '程序行')
      .replace(/[()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 48)
    out.push(`${raw.replace(/\s+$/, '')}  (${note})`)
  }

  return {
    ok: true,
    text: out.join('\n'),
    lineCount: out.length,
    annotatedLines: out.filter((l) => /\([^)]+\)\s*$/.test(l.trim())).length,
  }
}

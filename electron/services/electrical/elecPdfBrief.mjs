/**
 * 从 PDF 文本生成 Agent 出图用的「对照清单」— 让模型从源头写对 elec-json。
 */
import { schematicFromPdfText, splitSchematicPages } from './readSchematic.mjs'
import { extractPdfReferenceTags } from './elecPdfRef.mjs'
import { buildIoDescMapFromPdf, ioAddrsFromPageTitle, normIo } from './elecPdfIoMap.mjs'

function motorDescFromBlock(block) {
  if (/砂轮/.test(block)) return '砂轮电机'
  if (/液压/.test(block)) return '液压电机'
  if (/冷却/.test(block)) return '冷却电机'
  if (/磁过滤/.test(block)) return '磁过滤电机'
  if (/纸过滤/.test(block)) return '纸过滤电机'
  if (/润滑/.test(block)) return '润滑电机'
  if (/备用/.test(block)) return '备用电机'
  return ''
}

function controlKmDescFromPdf(text) {
  const pages = splitSchematicPages(text)
  const map = new Map()
  for (const p of pages) {
    if (!/控制回路/.test(p.body)) continue
    for (const m of p.body.matchAll(/\b(KM2\d)\b/gi)) {
      const km = m[1].toUpperCase()
      if (map.has(km)) continue
      const idx = m.index ?? 0
      const desc = motorDescFromBlock(p.body.slice(idx, idx + 100))
      if (desc) map.set(km, desc)
    }
  }
  return map
}

function motorCircuitsMikrosaFromPdf(text) {
  const pages = splitSchematicPages(text)
  const motorPages = pages.filter((p) => /主回路2|冷却|润滑|电机/i.test(p.body))
  const circuits = []
  const seen = new Set()
  for (const page of motorPages) {
    const body = page.body
    for (const m of body.matchAll(/\b(\d)Q(\d+)\b/g)) {
      const prefix = m[1]
      const n = m[2]
      const q = `${prefix}Q${n}`
      if (seen.has(q)) continue
      seen.add(q)
      const idx = m.index ?? 0
      const block = body.slice(idx, idx + 420)
      let km = new RegExp(`\\b${prefix}K${n}\\b`, 'i').test(body) ? `${prefix}K${n}` : ''
      let motor = new RegExp(`\\b${prefix}M${n}\\b`, 'i').test(body) ? `${prefix}M${n}` : ''
      if (!km) {
        const kMatch = block.match(new RegExp(`\\b${prefix}K(\\d+)\\b`, 'i'))
        if (kMatch) km = `${prefix}K${kMatch[1]}`
      }
      if (!motor) {
        const mMatch = block.match(new RegExp(`\\b${prefix}M(\\d+)\\b`, 'i'))
        if (mMatch) motor = `${prefix}M${mMatch[1]}`
      }
      const rating = (block.match(/(\d+(?:\.\d+)?(?:-\d+(?:\.\d+)?)?)\s*A/) || [])[1] || ''
      let desc = motorDescFromBlock(block)
      if (!desc && /LUBRICATION/i.test(block)) desc = '润滑泵'
      if (!desc && /GRINDING/i.test(block)) desc = '砂轮润滑'
      circuits.push({
        q,
        km: km || `${prefix}K${n}`,
        motor: motor || `${prefix}M${n}`,
        rating: rating ? `${rating}A` : '',
        desc,
        mikrosa: true,
      })
    }
  }
  return circuits.sort((a, b) => a.q.localeCompare(b.q, undefined, { numeric: true }))
}

export function motorCircuitsFromPdf(text) {
  return motorCircuitsFromPdfInternal(text)
}

function motorCircuitsFromPdfInternal(text) {
  const mikrosa = motorCircuitsMikrosaFromPdf(text)
  if (mikrosa.length) return mikrosa
  const pages = splitSchematicPages(text)
  const motorPage =
    pages.find((p) => /\bQ20\b/.test(p.body) && /\bKM20\b/.test(p.body)) ||
    pages.find((p) => /YLT[\s\t]+电机/.test(p.body)) ||
    pages.find((p) => /电机|motor/i.test(p.body))
  if (!motorPage) return []
  const body = motorPage.body
  const ctrlKmDesc = controlKmDescFromPdf(text)
  const circuits = []
  const seen = new Set()
  for (const m of body.matchAll(/\bQ(2\d)\b/g)) {
    const n = m[1]
    if (seen.has(n)) continue
    seen.add(n)
    const idx = m.index ?? body.search(new RegExp(`\\bQ${n}\\b`))
    const nextQ = body.indexOf(`Q${Number(n) + 1}`, idx + 1)
    const end = nextQ > idx ? nextQ : idx + 380
    const block = body.slice(idx, end)
    const rating = (block.match(/(\d+(?:\.\d+)?)\s*A/) || [])[1] || ''
    const motorM = block.match(/-M(\d+)/)
    let motor = motorM ? `M${motorM[1]}` : ''
    if (!motor) {
      const u = block.match(/\bU(\d+)\b/)
      if (u) motor = `M${u[1]}`
    }
    if (!motor) {
      const fallbackM = { 20: '1', 21: '2', 22: '3', 23: '4', 24: '5', 25: '6', 26: '7' }
      motor = fallbackM[n] ? `M${fallbackM[n]}` : ''
    }
    const kmIdx = body.search(new RegExp(`KM${n}\\b`))
    const kmBlock = kmIdx >= 0 ? body.slice(kmIdx, kmIdx + 160) : block
    let desc = motorDescFromBlock(kmBlock)
    const ctrlDesc = ctrlKmDesc.get(`KM${n}`)
    if (ctrlDesc && (!desc || desc === '备用电机')) desc = ctrlDesc
    circuits.push({
      q: `Q${n}`,
      km: `KM${n}`,
      motor,
      rating: rating ? `${rating}A` : '',
      desc,
    })
  }
  return circuits.sort((a, b) => a.q.localeCompare(b.q, undefined, { numeric: true }))
}

function ioHintsFromPdf(text) {
  const ioMap = buildIoDescMapFromPdf(text)
  const ref = extractPdfReferenceTags(text)
  const pages = splitSchematicPages(text)
  const pageByAddr = new Map()
  for (const p of pages) {
    if (!/I\/O UNIT|IO\s*UNIT/i.test(p.body) || !/TERM10[56]/i.test(p.body)) continue
    const title = p.body.match(/I\/O UNIT[^\n]*/i)?.[0] || ''
    for (const addr of ioAddrsFromPageTitle(title)) {
      pageByAddr.set(normIo(addr), title.slice(0, 50))
    }
  }
  return [...ref.ios]
    .sort()
    .map((addr) => ({
      addr,
      desc: ioMap.get(addr)?.desc || '',
      term: '',
      page: pageByAddr.get(addr) || ioMap.get(addr)?.page || '',
    }))
}

/** 给 Agent 的 PDF 对照清单（出 elec-json 前强制阅读） */
export function buildPdfElecBrief(pdfText) {
  const text = String(pdfText || '')
  if (text.length < 500) return ''

  let parsed
  try {
    parsed = schematicFromPdfText(text)
  } catch {
    parsed = { toc: [], project: {}, pages: [] }
  }

  const ref = extractPdfReferenceTags(text)
  const motors = motorCircuitsFromPdf(text)
  const ioRows = ioHintsFromPdf(text)
  const toc = (parsed.toc || []).length
    ? parsed.toc
    : (parsed.pages || []).map((p) => ({ no: p.no, title: p.title }))

  const lines = [
    '【PDF 对照清单 — 出 elec-json 前必读，须与 PDF 零差异】',
    '',
    `工程：${parsed.project?.machine || '（读 PDF 标题栏）'} · ${parsed.project?.control || ''} · ${parsed.project?.drawing || ''}`,
    '',
    '## 页目录（每页一段 ```elec-json```，page.no/title 对齐）',
    ...toc.map((t) => `- /${t.no} ${t.title}`),
    '',
    '## 电机主回路（每列竖串 Q→KM→M，Q 与 KM 编号相同；中间线写在 wiresIn/wiresOut，禁止写进 rails）',
  ]

  if (motors.length) {
    motors.forEach((c, i) => {
      lines.push(
        `- 列 ${i}：${c.q}${c.rating ? ` ${c.rating}` : ''} → ${c.km} → ${c.motor || 'M?'}${c.desc ? `（${c.desc}，与 PDF 一致）` : ''}`,
      )
    })
  } else {
    const mq = [...ref.tags].filter((t) => /^Q2/.test(t)).sort()
    mq.forEach((q, i) => {
      const n = q.slice(1)
      lines.push(`- 列 ${i}：${q} → KM${n} → M?（从 PDF 读额定与名称）`)
    })
  }

  lines.push('', '## rails 模板（电源/电机页只用这 4 条，勿加 R20/U1）', '- R, S, T, PE（type:pe）', '')

  lines.push('## 电源页 wires（列内必须首尾相接，禁止全空）')
  lines.push(
    '- Q1/Q2/Q3 等：wiresIn 接上级 rails（R,S,T 或 R1,S1,T1），wiresOut 写下游线号（R1,S1,T1 或 R200,S200,T200）',
    '- 24V/变压器列：PSU/transformer 的 wiresIn/wiresOut 必须连到 24P1、0V、R220 等，不得断链',
    '',
  )

  lines.push('## 电机页 wires 模板（以 Q20 列为例，其余列改编号）')
  lines.push(
    '- Q20: wiresIn [R,S,T] → wiresOut [R20,S20,T20]',
    '- KM20: wiresIn [R20,S20,T20] → wiresOut [U1,V1,W1]',
    '- M1: wiresIn [U1,V1,W1]',
    '',
  )

  const ioWithDesc = ioRows.filter((r) => r.desc).length
  lines.push(
    `## I/O 地址（PDF 共 ${ref.ios.size} 个；**每个 addr 必须写 desc**，禁止留空；已从 PDF 识别 ${ioWithDesc} 条功能名）`,
  )
  if (ioRows.length) {
    ioRows.forEach((r) => {
      lines.push(`- ${r.addr}：${r.desc || '（从 PDF 读功能名，禁止留空）'}${r.page ? ` · ${r.page}` : ''}`)
    })
  } else {
    ;[...ref.ios].sort().forEach((a) => lines.push(`- ${a}：（从 PDF 填功能名，禁止留空）`))
  }

  lines.push(
    '',
    '## 出图自检（系统校验，不过则拒出图）',
    '1. JSON 位号/I/O 与上表一致，不得多出/缺少',
    '2. 电机页每列 devices 长度≥3，符号序 breaker3→contactor→motor3',
    '3. 列内 wires 首尾相接；不得全空',
    '4. rails ≤6 且仅母线；控制页 KM 与电机页 KM 成对',
    '5. I/O 页 io[] 每项 desc 非空',
    '',
  )

  return lines.join('\n')
}

export { ioHintsFromPdf }

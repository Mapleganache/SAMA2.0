/**
 * 从 elec-json 导出元件连通性（md / txt），不出 SVG/PDF 原理图。
 */
import { countDevices } from './elecJson.mjs'

function slug(s) {
  return String(s || '')
    .replace(/[^\w\u4e00-\u9fff.-]+/g, '_')
    .slice(0, 48)
}

function listDevices(doc) {
  const out = []
  for (const col of doc.columns || []) {
    for (const d of col.devices || []) {
      if (!d?.tag) continue
      out.push({
        tag: d.tag,
        sym: d.sym || '',
        rating: d.rating || '',
        desc: d.desc || '',
        col: col.i,
        wiresIn: [...(d.wiresIn || [])],
        wiresOut: [...(d.wiresOut || [])],
      })
    }
  }
  return out
}

/** 按线号汇总：同一 wire 标签连接了哪些器件端 */
export function buildWireNets(docs) {
  const nets = new Map()
  const add = (wire, ref) => {
    const key = String(wire || '').trim()
    if (!key) return
    if (!nets.has(key)) nets.set(key, [])
    nets.get(key).push(ref)
  }
  for (const doc of docs || []) {
    const page = `${doc.page?.no || ''} · ${doc.page?.title || ''}`.trim()
    for (const dev of listDevices(doc)) {
      for (const w of dev.wiresIn) add(w, { page, tag: dev.tag, end: 'in' })
      for (const w of dev.wiresOut) add(w, { page, tag: dev.tag, end: 'out' })
    }
  }
  return nets
}

function columnChains(doc) {
  const lines = []
  for (const col of doc.columns || []) {
    const devs = (col.devices || []).filter((d) => d?.tag)
    if (!devs.length) continue
    const parts = []
    for (let i = 0; i < devs.length; i++) {
      const d = devs[i]
      const inW = (d.wiresIn || []).join(',')
      const outW = (d.wiresOut || []).join(',')
      let seg = d.tag
      if (d.desc) seg += `（${d.desc}）`
      if (d.rating) seg += `[${d.rating}]`
      if (inW || outW) seg += ` in:${inW || '—'} out:${outW || '—'}`
      parts.push(seg)
    }
    const chain = parts.join(' → ')
    lines.push({ col: col.i, chain, parts })
  }
  return lines
}

export function exportConnectivity(docs) {
  const list = Array.isArray(docs) ? docs : []
  const project = list[0]?.project || {}
  const nets = buildWireNets(list)
  let edgeCount = 0
  const netLines = []
  for (const [wire, refs] of nets.entries()) {
    if (refs.length < 2) continue
    edgeCount += refs.length - 1
    const ends = refs.map((r) => `${r.page} ${r.tag}.${r.end}`).join(' ↔ ')
    netLines.push({ wire, ends, refs })
  }

  const md = []
  const txt = []
  const machine = project.machine || '未知机床'
  const control = project.control || ''
  const title = `# 电路元件连通性 · ${machine}`
  md.push(title)
  if (control) md.push(`> 数控/PLC：${control}`)
  md.push(`> 生成说明：由 SAMA 识图/elec-json 提取；**不是**渲染原理图。`)
  md.push('')
  txt.push(`电路元件连通性 · ${machine}`)
  if (control) txt.push(`数控/PLC：${control}`)
  txt.push('---')

  for (const doc of list) {
    const pageNo = doc.page?.no ?? ''
    const pageTitle = doc.page?.title || '未命名页'
    const kind = doc.page?.kind || ''
    md.push(`## 页 ${pageNo} · ${pageTitle}${kind ? ` (${kind})` : ''}`)
    txt.push(`\n[页 ${pageNo}] ${pageTitle}`)

    const rails = (doc.rails || []).map((r) => r.label || r.id).filter(Boolean)
    if (rails.length) {
      md.push(`\n**母线 / 电位：** ${rails.join(' · ')}`)
      txt.push(`母线: ${rails.join(', ')}`)
    }

    const chains = columnChains(doc)
    if (chains.length) {
      md.push('\n### 列内元件链')
      md.push('| 列 | 连接链 |')
      md.push('| --- | --- |')
      for (const c of chains) {
        md.push(`| ${c.col} | ${c.chain.replace(/\|/g, '\\|')} |`)
        txt.push(`列${c.col}: ${c.chain}`)
      }
    }

    const devs = listDevices(doc)
    if (devs.length) {
      md.push('\n### 器件清单')
      md.push('| 位号 | 类型 | 额定 | 说明 | 入线 | 出线 |')
      md.push('| --- | --- | --- | --- | --- | --- |')
      for (const d of devs) {
        md.push(
          `| ${d.tag} | ${d.sym} | ${d.rating || ''} | ${(d.desc || '').replace(/\|/g, '/')} | ${d.wiresIn.join(',')} | ${d.wiresOut.join(',')} |`,
        )
        txt.push(
          `${d.tag} | ${d.sym} | ${d.rating || '-'} | ${d.desc || '-'} | in:${d.wiresIn.join(',') || '-'} | out:${d.wiresOut.join(',') || '-'}`,
        )
      }
    }

    const io = doc.io || []
    if (io.length) {
      md.push('\n### I/O')
      md.push('| 地址 | 说明 | 端子 |')
      md.push('| --- | --- | --- |')
      for (const row of io) {
        md.push(`| ${row.addr || ''} | ${(row.desc || row.name || '').replace(/\|/g, '/')} | ${row.term || ''} |`)
        txt.push(`I/O ${row.addr}: ${row.desc || row.name || ''} (${row.term || ''})`)
      }
    }

    const uncertain = doc.uncertain || []
    if (uncertain.length) {
      md.push('\n### 存疑')
      for (const u of uncertain) md.push(`- ${u}`)
      for (const u of uncertain) txt.push(`存疑: ${u}`)
    }
    md.push('')
  }

  if (netLines.length) {
    md.push('## 线号网络（跨器件）')
    md.push('| 线号/电位 | 连接点 |')
    md.push('| --- | --- |')
    for (const n of netLines) {
      md.push(`| ${n.wire} | ${n.ends.replace(/\|/g, '/')} |`)
      txt.push(`网络 ${n.wire}: ${n.ends}`)
    }
  }

  return {
    markdown: md.join('\n'),
    text: txt.join('\n'),
    deviceCount: list.reduce((n, d) => n + countDevices(d), 0),
    pageCount: list.length,
    edgeCount,
    netCount: netLines.length,
    project,
  }
}

export function defaultConnectivityStem(docs) {
  const machine = slug(docs[0]?.project?.machine || '电路图')
  const pages = docs.length
  return `${machine}_连通性_${pages}页`
}

/** 检查 SVG 文本是否包含 elec-json 里的位号（粗验示意图是否标全） */
export function auditSvgTagCoverage(svgTexts, docs) {
  const tags = []
  for (const doc of docs || []) {
    for (const col of doc.columns || []) {
      for (const d of col.devices || []) {
        if (d?.tag) tags.push(String(d.tag).trim())
      }
    }
    for (const row of doc.io || []) {
      if (row?.addr) tags.push(String(row.addr).trim())
    }
  }
  const combined = (Array.isArray(svgTexts) ? svgTexts : [svgTexts]).join('\n')
  const missing = []
  let found = 0
  for (const tag of tags) {
    if (combined.includes(tag)) found++
    else missing.push(tag)
  }
  return {
    totalTags: tags.length,
    foundInSvg: found,
    coveragePct: tags.length ? Math.round((found / tags.length) * 100) : 100,
    missingTags: missing.slice(0, 40),
  }
}

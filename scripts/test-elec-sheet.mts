import { existsSync } from 'node:fs'
import { renderElecSvg } from '../electron/services/electrical/renderSheet.mjs'
import { sasl32Power1, SASL32_TOC } from '../electron/services/electrical/sasl32Pack.mjs'
import { schematicFromPdfText } from '../electron/services/electrical/readSchematic.mjs'

function assert(cond, msg) {
  if (!cond) throw new Error(msg)
}

const { svg, bom, doc } = renderElecSvg(sasl32Power1())
assert(svg.includes('1Q1'), 'symbol 1Q1')
assert(svg.includes('L1'), 'rail L1')
assert(svg.includes('MIKROSA'), 'title machine')
assert(svg.includes('主回路1'), 'page title')
assert(svg.includes('FANUC 0iF'), 'control')
assert(!/<rect[^>]*width="70"[^>]*height="28"/.test(svg), 'not old box layout')
assert(bom.some((b) => b.id === '1Q1'), 'bom 1Q1')
assert(doc.page.no === 3, 'page 3')
assert(SASL32_TOC.length === 20, '20 pages')

const fakePdf = `
MIKROSA SASL 3/2 CNC
FANUC 0IF
SEIAL NO. 26590101
-- 1 of 20 --
标题
-- 2 of 20 --
目录 : /1 - /20
/1 标题
/2 目录 : /1 - /20
/3 主回路1
/4 主回路2
-- 3 of 20 --
主回路1
L1
L2
L3
PE
1Q1
2.5-4A
1T3
2.5KVA
`
const parsed = schematicFromPdfText(fakePdf)
assert(parsed.toc.some((t) => t.no === 3 && /主回路1/.test(t.title)), 'toc 主回路1')
assert(parsed.doc.columns.some((c) => c.devices.some((d) => d.tag === '1Q1')), 'extract 1Q1')

const realPdf =
  'd:/WeChat Files/xwechat_files/wxid_ii0n6459zu9322_fca9/msg/file/2026-08/MIKROSA SASL32 电路图.pdf'
if (existsSync(realPdf)) {
  const fs = await import('node:fs')
  const mod = await import('pdf-parse')
  const PDFParse = mod.PDFParse || mod.default?.PDFParse || mod.default
  const buf = fs.readFileSync(realPdf)
  let text = ''
  if (typeof PDFParse === 'function') {
    try {
      const parser = new PDFParse({ data: buf })
      if (typeof parser.getText === 'function') {
        const result = await parser.getText()
        text = String(result?.text || result || '')
      }
    } catch {
      const result = await PDFParse(buf)
      text = String(result?.text || '')
    }
  }
  const live = schematicFromPdfText(text)
  assert(live.pages.length >= 10, `pdf pages ${live.pages.length}`)
  assert(/SASL/i.test(`${live.project.machine} ${live.project.drawing} ${text.slice(0, 400)}`), 'pdf machine')
  console.log(`pdf pages ${live.pages.length} toc ${live.toc.length} current ${live.doc.page.title}`)
}

console.log('elec sheet ok')

/**
 * 把分页 HTML 打成真正的多页 PDF（A3 横版，一页一页，不是竖长图）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export async function htmlToPagedPdf(html, outAbsPath) {
  const { BrowserWindow, app } = await import('electron')
  if (!app.isReady()) {
    await app.whenReady()
  }
  const tmpHtml = path.join(os.tmpdir(), `sama-elec-book-${Date.now()}.html`)
  fs.writeFileSync(tmpHtml, html, 'utf8')
  const win = new BrowserWindow({
    show: false,
    width: 1684,
    height: 1191,
    webPreferences: {
      offscreen: true,
      sandbox: true,
    },
  })
  try {
    await win.loadFile(tmpHtml)
    await new Promise((r) => setTimeout(r, 400))
    const buf = await win.webContents.printToPDF({
      landscape: true,
      pageSize: 'A3',
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    })
    fs.mkdirSync(path.dirname(outAbsPath), { recursive: true })
    fs.writeFileSync(outAbsPath, buf)
    return { ok: true, path: outAbsPath, bytes: buf.length }
  } finally {
    try {
      win.destroy()
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(tmpHtml)
    } catch {
      /* ignore */
    }
  }
}

/**
 * 通过 FANUC LADDER-III 官方命令行导出助记符
 * 手册 B-66234EN 第 10 章：
 *   START /WAIT Fladder.exe /cmdfile=xxx.cmd /cmdlog=xxx.log
 *   FlOpen <lad>
 *   SrcToMnemonic /datatype=4 /mode=2 /file=<out.txt>
 *   FlClose
 *   End
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { launchGuiApp } from './guiLaunch.mjs'

const CANDIDATE_NAMES = ['fladder.exe', 'Fladder.exe', 'FLADDER.EXE']

/** 用户在 UI 点过「允许」后，本进程内可打开/导出 */
let sessionAllowLadderIii = false

export function setLadderIiiSessionAllow(allowed) {
  sessionAllowLadderIii = Boolean(allowed)
  return sessionAllowLadderIii
}

export function getLadderIiiSessionAllow() {
  return sessionAllowLadderIii
}

function desktopDir() {
  try {
    // eslint-disable-next-line global-require
    const { app } = require('electron')
    if (app?.getPath) return app.getPath('desktop')
  } catch {
    // ignore
  }
  return path.join(os.homedir(), 'Desktop')
}

/** 去掉只读（studer.LAD 等常带 ReadOnly，会导致 FlClose E-6051 无法落盘） */
export function ensureWritableFile(filePath) {
  const p = path.resolve(String(filePath || ''))
  if (!p || !fs.existsSync(p)) return false
  try {
    const st = fs.statSync(p)
    // Windows: clear read-only bit via chmod
    fs.chmodSync(p, st.mode | 0o200)
  } catch {
    try {
      fs.chmodSync(p, 0o666)
    } catch {
      return false
    }
  }
  return true
}

/** Fladder 工作目录 / 系统 Temp 下的 project.LAD，不能当用户工程 */
export function isEphemeralLadPath(p = '') {
  const s = String(p || '').replace(/\//g, '\\').toLowerCase()
  if (!s) return true
  if (/\\sama-fl3[^\\]*\\/i.test(s)) return true
  if (/\\temp\\sama-fl3/i.test(s)) return true
  if (/\\appdata\\local\\temp\\/i.test(s) && /\\project(_edited)?\.lad$/i.test(s)) return true
  if (/^[a-z]:\\temp\\/i.test(s) && /project(_edited)?\.lad$/i.test(s)) return true
  return false
}

/** 微信/QQ 等聊天目录常被占用或不可写 */
export function isStickyOrSyncLadDir(p = '') {
  const s = String(p || '').replace(/\//g, '\\').toLowerCase()
  if (!s) return false
  return /\\wechat files\\|\\xwechat_files\\|\\tencent files\\|\\qq\\|\\telegram desktop\\|\\dingtalk\\/i.test(
    s,
  )
}

function desktopWritableLadPath(fromLad) {
  const rawBase = path.basename(String(fromLad || 'project.LAD'))
  const stem = rawBase.replace(/\.lad$/i, '').replace(/[()\[\]{}]/g, '_').replace(/\s+/g, '_')
  const desk = desktopDir()
  let dest = path.join(desk, `${stem}.LAD`)
  if (fs.existsSync(dest) && path.resolve(dest) !== path.resolve(fromLad)) {
    dest = path.join(desk, `${stem}_sama_edit.LAD`)
  }
  return dest
}

/** 每次写入生成独立文件名，避免结果永远叫 studer.LAD */
export function buildNamedLadOutPath(sourceLad, tag = 'EDIT') {
  const desk = desktopDir()
  const stem = path
    .basename(String(sourceLad || 'project.LAD'), path.extname(sourceLad || '.LAD'))
    .replace(/[()\[\]{}]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '') || 'project'
  const safeTag = String(tag || 'EDIT')
    .replace(/[^\w\u4e00-\u9fff]/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 20) || 'EDIT'
  const stamp = Date.now().toString(36)
  let dest = path.join(desk, `${stem}_${safeTag}_${stamp}.LAD`)
  let n = 0
  while (fs.existsSync(dest) && n < 20) {
    n += 1
    dest = path.join(desk, `${stem}_${safeTag}_${stamp}_${n}.LAD`)
  }
  return dest
}

/**
 * 写回前把「微信目录等」里的 LAD 拷到桌面，避免 EPERM
 */
export function ensureEditableLadPath(candidate = '') {
  const resolved = resolveUsableLadPath(candidate)
  if (!resolved.ok) return resolved
  const p = resolved.path
  if (!isStickyOrSyncLadDir(p)) {
    return { ok: true, path: p, corrected: Boolean(resolved.corrected), note: '' }
  }
  const dest = desktopWritableLadPath(p)
  try {
    fs.copyFileSync(p, dest)
    return {
      ok: true,
      path: dest,
      corrected: true,
      from: p,
      note: `原 LAD 在微信等目录（常被锁），已复制到桌面再改：\`${dest}\``,
    }
  } catch (e) {
    return {
      ok: false,
      path: '',
      error: `原文件在微信目录且无法复制到桌面：${e.message || e}。请手动把 .LAD 拷到桌面后再试。`,
    }
  }
}


function runFladderSync(exe, cmdPath, logPath, timeoutMs) {
  const r = spawnSync(exe, [`/cmdfile=${cmdPath}`, `/cmdlog=${logPath}`], {
    windowsHide: true,
    timeout: timeoutMs,
    encoding: 'utf8',
    cwd: path.dirname(exe),
  })
  return { error: r.error || null, status: r.status ?? 0 }
}

/** 报告等同步路径用（会短暂阻塞）；UI 写回请用 async 版 */
export function exportMnemonicViaLadderIiiSync(
  ladPath,
  { fladderPath = '', outPath = '', timeoutMs = 180_000, mode = 2 } = {},
) {
  const resolved = resolveUsableLadPath(ladPath)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  const ladOrig = resolved.path
  const exe = resolveFladderPath(fladderPath)
  if (!exe) return { ok: false, error: '未找到 fladder.exe' }
  const work = path.join(os.tmpdir(), `sama-fl3-${Date.now().toString(36)}`)
  fs.mkdirSync(work, { recursive: true })
  const ladAscii = path.join(work, 'project.LAD')
  const mneAscii = path.join(work, 'mnemonic.txt')
  const cmdPath = path.join(work, 'export.cmd')
  const logPath = path.join(work, 'export.log')
  const finalMne = outPath
    ? path.resolve(outPath)
    : path.join(
        path.dirname(ladOrig),
        `${path.basename(ladOrig, path.extname(ladOrig))}_mnemonic.txt`,
      )
  try {
    fs.copyFileSync(ladOrig, ladAscii)
    ensureWritableFile(ladAscii)
  } catch (e) {
    return { ok: false, error: String(e.message || e) }
  }
  const modeNum = [0, 1, 2].includes(Number(mode)) ? Number(mode) : 2
  fs.writeFileSync(
    cmdPath,
    [
      `FlOpen "${ladAscii}"`,
      `SrcToMnemonic /datatype=0 /mode=${modeNum} /file="${mneAscii}"`,
      'FlClose',
      'End',
      '',
    ].join('\r\n'),
    'ascii',
  )
  const r = runFladderSync(exe, cmdPath, logPath, timeoutMs)
  let log = ''
  try {
    if (fs.existsSync(logPath)) log = fs.readFileSync(logPath, 'utf8').slice(0, 8000)
  } catch {
    /* ignore */
  }
  if (r.error) return { ok: false, error: String(r.error.message || r.error), log }
  if (!fs.existsSync(mneAscii) || fs.statSync(mneAscii).size < 40) {
    return { ok: false, error: `未生成助记符。${log.slice(0, 300)}`, log }
  }
  fs.mkdirSync(path.dirname(finalMne), { recursive: true })
  fs.copyFileSync(mneAscii, finalMne)
  return { ok: true, mnemonicPath: finalMne, fladderPath: exe, log }
}

function runFladderAsync(exe, cmdPath, logPath, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(exe, [`/cmdfile=${cmdPath}`, `/cmdlog=${logPath}`], {
      windowsHide: true,
      cwd: path.dirname(exe),
      stdio: 'ignore',
    })
    let settled = false
    const finish = (payload) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(payload)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        /* ignore */
      }
      finish({ error: new Error(`fladder 超时（>${timeoutMs}ms）`), status: -1 })
    }, timeoutMs)
    child.on('error', (error) => finish({ error, status: -1 }))
    child.on('close', (status) => finish({ error: null, status: status ?? 0 }))
  })
}


function sleepAsync(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 纠正错误/幻觉的 .LAD 路径（常见：写成 Desktop\\SAMA\\studer.LAD，实际在桌面根目录）
 * @returns {{ ok: boolean, path: string, corrected?: boolean, tried?: string[], error?: string }}
 */
export function resolveUsableLadPath(candidate = '') {
  const tried = []
  const push = (p) => {
    const abs = path.resolve(String(p || '').trim())
    if (!abs || tried.includes(abs) || isEphemeralLadPath(abs)) return
    tried.push(abs)
  }

  const raw = String(candidate || '').trim()
  if (raw && !isEphemeralLadPath(raw)) push(raw)

  const desk = desktopDir()
  if (raw) {
    const base = path.basename(raw)
    if (/\.lad$/i.test(base) && !/^project(_edited)?\.lad$/i.test(base)) {
      push(path.join(desk, base))
    }
    // ...\Desktop\SAMA\xxx.LAD → ...\Desktop\xxx.LAD
    const norm = raw.replace(/\//g, '\\')
    const m = norm.match(/^(.*)\\SAMA\\([^\\]+\.LAD)$/i)
    if (m) push(path.join(m[1], m[2]))
  }
  // 仅当用户没给任何路径时，才回落到桌面 studer.LAD（避免把每次结果都叫成这个）
  if (!raw) push(path.join(desk, 'studer.LAD'))

  for (const t of tried) {
    if (fs.existsSync(t) && !isEphemeralLadPath(t)) {
      return {
        ok: true,
        path: t,
        corrected: Boolean(raw) && path.resolve(raw) !== t,
        tried,
      }
    }
  }
  return {
    ok: false,
    path: '',
    error: `找不到可用的 .LAD（已试：${tried.slice(0, 4).join('；')}）`,
    tried,
  }
}

const SEARCH_DIRS = [
  process.env.FANUC_LADDER_III || '',
  process.env.FLADDER_PATH || '',
  'C:\\Program Files\\FANUC\\FANUC LADDER-III',
  'C:\\Program Files (x86)\\FANUC\\FANUC LADDER-III',
  'C:\\Program Files\\FANUC\\LADDER-III',
  'C:\\Program Files (x86)\\FANUC\\LADDER-III',
  'C:\\FANUC\\FANUC LADDER-III',
  'D:\\FANUC\\FANUC LADDER-III',
  'D:\\FANUC SOFTWARE\\FANUC LADDER-III',
  'D:\\FANUC SOFTWARE',
  'D:\\机床软件',
]

function looksLikeFladder(p) {
  return p && /\bfladder\.exe$/i.test(p) && fs.existsSync(p)
}

/** 解析用户配置或常见安装路径中的 fladder.exe */
export function resolveFladderPath(configured = '') {
  const cfg = String(configured || '').trim()
  if (cfg) {
    if (looksLikeFladder(cfg)) return path.resolve(cfg)
    const asDir = path.join(cfg, 'fladder.exe')
    if (looksLikeFladder(asDir)) return path.resolve(asDir)
  }
  for (const dir of SEARCH_DIRS) {
    if (!dir) continue
    if (looksLikeFladder(dir)) return path.resolve(dir)
    for (const name of CANDIDATE_NAMES) {
      const full = path.join(dir, name)
      if (looksLikeFladder(full)) return path.resolve(full)
    }
  }
  return ''
}

/**
 * 用 LADDER-III 把 LAD 转成助记符文本文件
 * 注意：中文路径会导致 FlOpen A:E-6009，故先复制到纯 ASCII 临时目录再转换，再拷回目标。
 * @returns {{ ok: boolean, mnemonicPath?: string, fladderPath?: string, log?: string, error?: string }}
 */
export async function exportMnemonicViaLadderIii(
  ladPath,
  { fladderPath = '', outPath = '', timeoutMs = 180_000, mode = 2 } = {},
) {
  const resolved = resolveUsableLadPath(ladPath)
  if (!resolved.ok) {
    return { ok: false, error: resolved.error }
  }
  const ladOrig = resolved.path
  if (!fs.existsSync(ladOrig)) {
    return { ok: false, error: `LAD 不存在：${ladOrig}` }
  }
  const exe = resolveFladderPath(fladderPath)
  if (!exe) {
    return {
      ok: false,
      error:
        '未找到 fladder.exe。请安装 FANUC LADDER-III，并在设置中填写安装目录或 fladder.exe 完整路径。',
    }
  }

  const work = path.join(os.tmpdir(), `sama-fl3-${Date.now().toString(36)}`)
  fs.mkdirSync(work, { recursive: true })
  const ladAscii = path.join(work, 'project.LAD')
  const mneAscii = path.join(work, 'mnemonic.txt')
  const cmdPath = path.join(work, 'export.cmd')
  const logPath = path.join(work, 'export.log')
  const finalMne = outPath
    ? path.resolve(outPath)
    : path.join(
        path.dirname(ladOrig),
        `${path.basename(ladOrig, path.extname(ladOrig))}_mnemonic.txt`,
      )

  try {
    fs.copyFileSync(ladOrig, ladAscii)
    ensureWritableFile(ladAscii)
  } catch (e) {
    return { ok: false, fladderPath: exe, error: `无法复制 LAD 到临时目录：${e.message || e}` }
  }

  // datatype=0 全部；mode=2 适合阅读/分析，mode=1 才能稳定 MnemonicToSrc 往返写回
  const modeNum = [0, 1, 2].includes(Number(mode)) ? Number(mode) : 2
  const cmdBody = [
    `FlOpen "${ladAscii}"`,
    `SrcToMnemonic /datatype=0 /mode=${modeNum} /file="${mneAscii}"`,
    'FlClose',
    'End',
    '',
  ].join('\r\n')
  fs.writeFileSync(cmdPath, cmdBody, 'ascii')

  try {
    const r = await runFladderAsync(exe, cmdPath, logPath, timeoutMs)
    let log = ''
    if (fs.existsSync(logPath)) {
      try {
        log = fs.readFileSync(logPath, 'utf8').slice(0, 8000)
      } catch {
        /* ignore */
      }
    }
    // 额外读 FLMNE.TXT（同目录）
    const flmne = path.join(work, 'FLMNE.TXT')
    if (fs.existsSync(flmne)) {
      try {
        log += `\n--- FLMNE.TXT ---\n${fs.readFileSync(flmne, 'utf8').slice(0, 4000)}`
      } catch {
        /* ignore */
      }
    }

    if (r.error) {
      return { ok: false, fladderPath: exe, error: String(r.error.message || r.error), log }
    }

    if (!fs.existsSync(mneAscii) || fs.statSync(mneAscii).size < 40) {
      const hint = /E-6009|opening error/i.test(log)
        ? '（LAD 打开失败：路径/占用/授权）'
        : /password|PASSWORD|E-31/i.test(log)
          ? '（可能有密码保护）'
          : ''
      return {
        ok: false,
        fladderPath: exe,
        error: `LADDER-III 未生成有效助记符${hint}。日志：${log.slice(0, 400)}`,
        log,
      }
    }

    fs.mkdirSync(path.dirname(finalMne), { recursive: true })
    fs.copyFileSync(mneAscii, finalMne)
    return { ok: true, mnemonicPath: finalMne, fladderPath: exe, log, workDir: work }
  } catch (e) {
    return { ok: false, fladderPath: exe, error: String(e.message || e) }
  }
}

/** 探测本机是否可用 LADDER-III CLI */
export function probeLadderIii(configured = '') {
  const exe = resolveFladderPath(configured)
  return {
    found: Boolean(exe),
    fladderPath: exe || '',
    hint: exe
      ? '已找到 LADDER-III，报告时可尝试自动导出助记符'
      : '未找到 fladder.exe；可手动 Tool→Source Program Convert 导出 .txt，或与 .LAD 同目录放置助记符',
  }
}

/**
 * 用户点「允许」后的完整流水线：
 * 1) 导出助记符（CLI） 2) 生成问题报告 3) 可选打开 GUI
 */
export async function analyzeLadAfterAllow(ladPath, { fladderPath = '', openGui = true } = {}) {
  setLadderIiiSessionAllow(true)
  const resolved = resolveUsableLadPath(ladPath)
  if (!resolved.ok) {
    return { ok: false, error: resolved.error }
  }
  const lad = resolved.path
  if (!lad || !fs.existsSync(lad)) {
    return { ok: false, error: `LAD 不存在：${lad}` }
  }

  const outMnemonic = path.join(
    path.dirname(lad),
    `${path.basename(lad, path.extname(lad))}_mnemonic.txt`,
  )
  // 先导出（GUI 占用时也可能失败，故先 CLI）；成功后再开 GUI
  const exp = await exportMnemonicViaLadderIii(lad, {
    fladderPath,
    outPath: outMnemonic,
    timeoutMs: 180_000,
  })

  const ladMod = await import('./fanucLad.mjs')
  const { writeUtf8Text } = await import('./textEncoding.mjs')
  const report = ladMod.buildLadAnalysisReport(lad, {
    fladderPath,
    tryExportMnemonic: false,
    mnemonicPath: exp.ok ? exp.mnemonicPath : '',
  })
  const reportPath = ladMod.defaultLadReportPath(lad)
  writeUtf8Text(reportPath, report.markdown, { bom: true })

  let gui = { ok: false, skipped: true }
  if (openGui) {
    gui = openLadInLadderIii(lad, { fladderPath })
  }

  // 仅在助记符成功时摘「已见互锁」类结果；失败则不伪装成核验结果
  const interlockLines = []
  if (exp.ok && report.mnemonicLoaded) {
    const md = report.markdown || ''
    for (const m of md.matchAll(
      /\| ([^|\n]*(?:已见互锁|未见互锁|未见对应线圈|仍待人工)[^|\n]*) \|/g,
    )) {
      interlockLines.push(m[1].trim())
    }
  }

  return {
    ok: true,
    degraded: !exp.ok,
    ladPath: lad,
    exportOk: Boolean(exp.ok),
    exportError: exp.error || '',
    exportLog: exp.log || '',
    mnemonicPath: exp.mnemonicPath || '',
    reportPath,
    issueCount: report.issueCount,
    mnemonicLoaded: Boolean(report.mnemonicLoaded),
    interlockSample: interlockLines.slice(0, 10),
    gui,
    bytes: report.bytes,
  }
}

/**
 * 用 LADDER-III 打开 .LAD（GUI）。
 * 许可/更新弹窗由用户点；SAMA 用 Start-Process 启动且不阻塞等待。
 */
export function openLadInLadderIii(ladPath, { fladderPath = '' } = {}) {
  const resolved = resolveUsableLadPath(ladPath)
  if (!resolved.ok) {
    return { ok: false, error: resolved.error }
  }
  const lad = resolved.path
  if (!lad || !fs.existsSync(lad)) {
    return { ok: false, error: `LAD 不存在：${lad}` }
  }
  if (!/\.lad$/i.test(lad)) {
    return { ok: false, error: '只能打开 .LAD 工程' }
  }
  const exe = resolveFladderPath(fladderPath)
  if (exe) {
    const r = launchGuiApp({
      exe,
      args: [lad],
      cwd: path.dirname(exe),
      documentPath: lad,
      processNames: ['fladder', 'Fladder', 'FLADDER'],
    })
    return {
      ok: r.ok,
      fladderPath: exe,
      ladPath: lad,
      method: r.method || 'fladder',
      note: r.note,
      error: r.error,
    }
  }
  if (process.platform === 'win32') {
    const r = launchGuiApp({ documentPath: lad, processNames: ['fladder', 'Fladder'] })
    return {
      ok: r.ok,
      fladderPath: '',
      ladPath: lad,
      method: 'shell',
      note: r.note,
      error: r.error,
    }
  }
  return { ok: false, error: '未找到 fladder.exe，请在设置中填写 LADDER-III 路径' }
}

function padBitAddr(addr) {
  const m = String(addr || '').trim().match(/^([A-Z]+)(\d+)\.(\d+)$/i)
  if (!m) return String(addr || '').trim()
  const head = m[1].toUpperCase()
  const num = m[2].padStart(4, '0')
  return `${head}${num}.${m[3]}`
}

/**
 * 在助记符全文中追加测试符号 + 梯级（mode=1 格式；须落在 %@2/%@3 段内）
 */
export function appendTestRungToMnemonic(mnemonicText, proposed = {}) {
  const name = String(proposed.name || 'TEST_BTN').replace(/[^\w]/g, '_').slice(0, 16)
  const flag = `${name}_FLAG`.slice(0, 16)
  const input = padBitAddr(proposed.input || 'X0.1')
  const output = padBitAddr(proposed.output || 'R100.0')
  const inputShort = String(proposed.input || 'X0.1').replace(/^([A-Z]+)0+(\d)/i, '$1$2')
  const outputShort = String(proposed.output || 'R100.0').replace(/^([A-Z]+)0+(\d)/i, '$1$2')
  let text = String(mnemonicText || '').replace(/\r\n/g, '\n')
  if (!text.includes('%@3')) {
    throw new Error('助记符缺少 %@3 梯形段，无法追加')
  }

  const alreadyNet = new RegExp(
    `RD\\s+${inputShort.replace('.', '\\.')}\\b[\\s\\S]{0,120}?WRT\\s+${outputShort.replace('.', '\\.')}\\b`,
    'i',
  ).test(text)
  if (
    alreadyNet ||
    text.includes(`${input} ${name}`) ||
    text.includes(`;(${name}`)
  ) {
    return { text: text.replace(/\n/g, '\r\n'), skipped: true, name, flag, input, output }
  }

  const symComment = (label) => {
    const left = `$1 '${label}'`
    const pad = Math.max(1, 40 - left.length)
    return `${left}${' '.repeat(pad)}'${label}'`
  }
  const symBlock = [
    `${input} ${name}`,
    symComment(name),
    `${output} ${flag}`,
    symComment(flag),
  ].join('\n')

  // 地址符号插在同类 X/R 附近（按地址排序更稳）；勿插在 P000x 程序名之后
  const x0 = text.match(/\n(X0000\.0[^\n]*\n(?:\$1[^\n]*\n)?)/)
  if (x0 && text.indexOf(x0[0]) < text.indexOf('%@3')) {
    text = text.replace(x0[0], `${x0[0]}${symBlock}\n`)
  } else if (/\nP0001\b/.test(text) && text.indexOf('\nP0001') < text.indexOf('%@3')) {
    text = text.replace(/\nP0001\b/, `\n${symBlock}\nP0001`)
  } else if (/\n%\n%@3\n/.test(text)) {
    text = text.replace(/\n%\n%@3\n/, `\n${symBlock}\n%\n%@3\n`)
  } else if (/\n%@3\n/.test(text)) {
    text = text.replace(/\n%@3\n/, `\n${symBlock}\n%@3\n`)
  } else {
    throw new Error('无法定位 %@2/%@3 边界以写入符号')
  }

  // mode=1： N00xxx: SUB 72 ; SPE / SUB 64 ; END —— 插在 SPE 前并顺延网号
  // mode=2： SPE / END
  const speEnd = text.match(
    /\n (N)(\d+):\s*SUB\s+72([^\n]*)\n N(\d+):\s*SUB\s+64([^\n]*)\n%\n%@4\n/i,
  )
  if (speEnd) {
    const speNum = Number(speEnd[2])
    const nNew = String(speNum).padStart(5, '0')
    const nSpe = String(speNum + 1).padStart(5, '0')
    const nEnd = String(speNum + 2).padStart(5, '0')
    const namePad = name.padEnd(8).slice(0, 8)
    const flagPad = flag.length <= 8 ? flag.padEnd(8) : flag.slice(0, 8)
    const rung = [
      ` N${nNew}: RD         ${inputShort.padEnd(8)};(${namePad})   "${name}"`,
      `         WRT        ${outputShort.padEnd(8)};(${flagPad})   "${flag}"`,
      ` N${nSpe}: SUB        72${speEnd[3]}`,
      ` N${nEnd}: SUB        64${speEnd[5]}`,
      `%`,
      `%@4`,
      '',
    ].join('\n')
    text = text.replace(speEnd[0], `\n${rung}`)
  } else if (/\n\s*SPE\s*\n\s*END\s*\n%\n%@4\n/i.test(text)) {
    const rung = [
      `                 RD        ${name.padEnd(16)} ;<${input.padEnd(7)}> "${name}"`,
      `                 WRT       ${flag.padEnd(16)} ;<${output.padEnd(7)}> "${flag}"`,
    ].join('\n')
    text = text.replace(/(\n)(\s*SPE\s*\n\s*END\s*\n%\n%@4\n)/i, `\n${rung}\n$2`)
  } else {
    throw new Error('无法定位 %@3 末尾 SPE/END 以写入梯级')
  }

  return {
    text: text.replace(/\n/g, '\r\n'),
    skipped: false,
    name,
    flag,
    input,
    output,
  }
}

function sleepMs(ms) {
  // 勿用 Atomics.wait 堵主进程（会导致窗口「未响应」）
  const end = Date.now() + Math.min(Math.max(0, ms), 250)
  while (Date.now() < end) {
    /* spin briefly */
  }
}

/** 写回 LAD：优先覆盖目标；占用则桌面另存（微信目录同名另存也会 EPERM） */
function copyLadResult(srcLad, destLad) {
  const srcSize = fs.existsSync(srcLad) ? fs.statSync(srcLad).size : 0
  if (srcSize < 100) {
    return { ok: false, error: `临时 LAD 无效（${srcSize} 字节），拒绝写回` }
  }
  if (isEphemeralLadPath(destLad)) {
    return { ok: false, error: `拒绝覆盖临时路径：${destLad}` }
  }
  let lastErr = null
  for (let i = 0; i < 4; i++) {
    try {
      fs.copyFileSync(srcLad, destLad)
      const n = fs.statSync(destLad).size
      if (n < 100) throw new Error(`目标写入后仅 ${n} 字节`)
      return { ok: true, path: destLad, alternate: false, bytes: n }
    } catch (e) {
      lastErr = e
      sleepMs(200 + i * 200)
    }
  }

  // 同目录 *_edited 也常因微信锁失败 → 直接落到桌面
  const deskDest = desktopWritableLadPath(
    isStickyOrSyncLadDir(destLad) ? destLad : destLad.replace(/\.lad$/i, '_edited.LAD'),
  )
  try {
    fs.copyFileSync(srcLad, deskDest)
    const n = fs.statSync(deskDest).size
    if (n < 100) {
      try {
        fs.unlinkSync(deskDest)
      } catch {
        /* ignore */
      }
      return {
        ok: false,
        error: `无法写回原文件（${lastErr?.message || lastErr}），桌面另存也无效。请关闭 LADDER-III 后重试。`,
      }
    }
    return {
      ok: true,
      path: deskDest,
      alternate: true,
      bytes: n,
      note: `原路径被占用/不可写（常为微信目录或 LADDER-III 占用），已成功写到桌面：\`${deskDest}\`（${n} 字节）。请用这个文件打开核对。`,
    }
  } catch (e2) {
    return {
      ok: false,
      error: `原文件被占用无法覆盖（${lastErr?.message || lastErr}）；桌面另存也失败：${e2.message || e2}。请关闭 LADDER-III，并把 LAD 拷到桌面后再试。`,
    }
  }
}

/**
 * 官方命令 MnemonicToSrc：把助记符写回已打开的 LAD（与 Cursor 改文本同思路）
 */
export async function importMnemonicViaLadderIii(
  ladPath,
  mnemonicPath,
  { fladderPath = '', timeoutMs = 180_000, compile = false, outPath = '', init = '' } = {},
) {
  const resolved = resolveUsableLadPath(ladPath)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  const ladOrig = resolved.path
  if (isEphemeralLadPath(ladOrig)) {
    return { ok: false, error: `拒绝写回临时路径：${ladOrig}` }
  }
  const destFinal = outPath
    ? path.resolve(String(outPath))
    : isStickyOrSyncLadDir(ladOrig)
      ? desktopWritableLadPath(ladOrig)
      : ladOrig
  if (isEphemeralLadPath(destFinal)) {
    return { ok: false, error: `拒绝写到临时路径：${destFinal}` }
  }
  const mneOrig = path.resolve(String(mnemonicPath || ''))
  if (!fs.existsSync(mneOrig)) return { ok: false, error: `助记符不存在：${mneOrig}` }

  const exe = resolveFladderPath(fladderPath)
  if (!exe) {
    return { ok: false, error: '未找到 fladder.exe，无法写回 LAD' }
  }

  const work = path.join(os.tmpdir(), `sama-fl3-imp-${Date.now().toString(36)}`)
  fs.mkdirSync(work, { recursive: true })
  const ladAscii = path.join(work, 'project.LAD')
  const mneAscii = path.join(work, 'mnemonic.txt')
  const cmdPath = path.join(work, 'import.cmd')
  const logPath = path.join(work, 'import.log')
  const bakDir = isStickyOrSyncLadDir(ladOrig) ? desktopDir() : path.dirname(ladOrig)
  const bak = path.join(
    bakDir,
    `${path.basename(ladOrig, path.extname(ladOrig))}.bak-sama-${Date.now().toString(36)}.LAD`,
  )

  try {
    fs.copyFileSync(ladOrig, bak)
    ensureWritableFile(bak)
    fs.copyFileSync(ladOrig, ladAscii)
    ensureWritableFile(ladAscii)
    fs.copyFileSync(mneOrig, mneAscii)
    ensureWritableFile(mneAscii)
  } catch (e) {
    return { ok: false, error: `准备临时文件失败：${e.message || e}` }
  }

  const initArg = String(init || '').trim()
  // /init=4 删除全部梯形后再转换；/init=0 初始化全部。默认不加：追加/合并（适合局部改）
  const mneCmd = initArg
    ? `MnemonicToSrc /file="${mneAscii}" /init=${initArg}`
    : `MnemonicToSrc /file="${mneAscii}"`
  const lines = [
    `FlOpen "${ladAscii}"`,
    mneCmd,
    // 注意：Compile 失败会中断批处理导致 FlClose 不执行，故不放在同一 cmd
    'FlClose',
    'End',
    '',
  ]
  fs.writeFileSync(cmdPath, lines.join('\r\n'), 'ascii')

  try {
    const r = await runFladderAsync(exe, cmdPath, logPath, timeoutMs)
    let log = ''
    if (fs.existsSync(logPath)) {
      try {
        log = fs.readFileSync(logPath, 'utf8').slice(0, 12000)
      } catch {
        /* ignore */
      }
    }
    if (r.error) {
      return { ok: false, error: String(r.error.message || r.error), log, backupPath: bak }
    }
    // 读 FLMNE.TXT：梯形 Error count ≠ 0 视为失败（否则会静默写出坏 LAD）
    let flmne = ''
    const flmnePath = path.join(work, 'FLMNE.TXT')
    if (fs.existsSync(flmnePath)) {
      try {
        flmne = fs.readFileSync(flmnePath, 'utf8').slice(0, 8000)
        log += `\n--- FLMNE.TXT ---\n${flmne}`
      } catch {
        /* ignore */
      }
    }
    const errCount = flmne.match(/#####\s*LADDER[\s\S]*?Error\s*count\s*[:=]?\s*(\d+)/i)
    const anyErr = flmne.match(/Error\s*count\s*[:=]?\s*(\d+)/gi) || []
    const ladderErrs = errCount ? Number(errCount[1]) : 0
    // 兼容：若找不到 LADDER 段标题，则任一段 Error count>0 都视为失败
    const fallbackErr = !errCount
      ? anyErr.some((line) => Number(String(line).match(/(\d+)/)?.[1] || 0) > 0)
      : false
    if (ladderErrs > 0 || fallbackErr) {
      return {
        ok: false,
        error: `MnemonicToSrc 梯形 Error count=${ladderErrs || '?'}（助记符格式或地址不合法）`,
        log,
        backupPath: bak,
      }
    }
    if (!/MNEMONICTOSRC:\s*Completed/i.test(log) && !/MnemonicToSrc/i.test(log)) {
      // 仍尝试拷贝；有些语言日志不同
    }
    if (!/Completed/i.test(log) && /error|E-/i.test(log)) {
      return {
        ok: false,
        error: `MnemonicToSrc 可能未完成。日志：${log.slice(0, 500)}`,
        log,
        backupPath: bak,
      }
    }
    if (!fs.existsSync(ladAscii) || fs.statSync(ladAscii).size < 100) {
      return { ok: false, error: '命令执行后临时 LAD 无效', log, backupPath: bak }
    }
    if (/E-6051|Read-only|can't be updated|cannot be updated/i.test(log)) {
      return {
        ok: false,
        error:
          'MnemonicToSrc 后无法保存（LAD 只读或被占用）。已尝试清除只读；请确认源文件可写并关闭 LADDER-III。',
        log,
        backupPath: bak,
      }
    }
    // FlClose 后稍等再拷，降低句柄未释放导致的 EPERM
    await sleepAsync(500)
    ensureWritableFile(destFinal)
    const copied = copyLadResult(ladAscii, destFinal)
    if (!copied.ok) {
      return {
        ok: false,
        error: copied.error,
        log,
        backupPath: bak,
        stashPath: copied.stashPath || '',
        bytes: copied.bytes || 0,
      }
    }

    // 可选二次 Compile（默认关：减少未响应；需要时可显式打开）
    let compiled = false
    let compileLog = ''
    if (compile) {
      const cWork = path.join(work, 'compile')
      fs.mkdirSync(cWork, { recursive: true })
      const cLad = path.join(cWork, 'project.LAD')
      const cCmd = path.join(cWork, 'compile.cmd')
      const cLog = path.join(cWork, 'compile.log')
      try {
        fs.copyFileSync(copied.path, cLad)
        fs.writeFileSync(
          cCmd,
          [`FlOpen "${cLad}"`, 'Compile /condense=1 /symbol=1', 'FlClose', 'End', ''].join('\r\n'),
          'ascii',
        )
        await runFladderAsync(exe, cCmd, cLog, timeoutMs)
        if (fs.existsSync(cLog)) compileLog = fs.readFileSync(cLog, 'utf8').slice(0, 4000)
        if (/COMPILE:\s*Completed/i.test(compileLog)) {
          compiled = true
          const cCopy = copyLadResult(cLad, copied.path)
          if (cCopy.ok) copied.path = cCopy.path
        }
      } catch {
        /* compile optional */
      }
    }

    return {
      ok: true,
      ladPath: copied.path,
      backupPath: bak,
      mnemonicPath: mneOrig,
      fladderPath: exe,
      log: log + (compileLog ? `\n--- compile ---\n${compileLog}` : ''),
      compiled,
      alternate: Boolean(copied.alternate),
      bytes: copied.bytes || (fs.existsSync(copied.path) ? fs.statSync(copied.path).size : 0),
      note: copied.note || '',
    }
  } catch (e) {
    return { ok: false, error: String(e.message || e), backupPath: bak }
  }
}

/** 纠正助手常瞎写的非法地址（0i-F 上 X1000/R9000 等） */
export function normalizeProposedEdit(proposed = {}) {
  const name = String(proposed.name || 'TEST_BTN').replace(/[^\w]/g, '_').slice(0, 16) || 'TEST_BTN'
  let input = String(proposed.input || 'X0.1').trim().toUpperCase()
  let output = String(proposed.output || 'R100.0').trim().toUpperCase()
  const badIn = !/^X\d{1,4}\.\d$/.test(input) || /^X(1000|1\d{3})\./.test(input)
  const badOut =
    !/^R\d{1,4}\.\d$/.test(output) || /^R(9\d{3}|8\d{3})\./.test(output)
  if (badIn) input = 'X0.1'
  if (badOut) output = 'R100.0'
  return {
    name,
    input,
    output,
    corrected: badIn || badOut,
    note:
      badIn || badOut
        ? `地址已纠正为 ${input}→${output}（原提案含本机常非法的地址）`
        : '',
  }
}

/**
 * Cursor 同款思路：导出助记符 → 改文本追加梯级 → MnemonicToSrc 写回 .LAD
 */
export async function applyLadEditViaMnemonic(ladPath, proposed = {}, { fladderPath = '' } = {}) {
  const resolved = ensureEditableLadPath(ladPath)
  if (!resolved.ok) return { ok: false, error: resolved.error }
  if (isEphemeralLadPath(resolved.path)) {
    return { ok: false, error: `拒绝写回临时路径：${resolved.path}` }
  }
  const lad = resolved.path
  const pathNote = resolved.note || ''
  const normalized = normalizeProposedEdit(proposed)
  proposed = normalized

  const exp = await exportMnemonicViaLadderIii(lad, { fladderPath, mode: 1 })
  if (!exp.ok) {
    return {
      ok: false,
      error: `导出助记符失败（请先关闭 LADDER-III 里已打开的同一工程）：${exp.error || ''}`,
      exportLog: exp.log,
    }
  }

  let rawBuf
  try {
    rawBuf = fs.readFileSync(exp.mnemonicPath)
  } catch (e) {
    return { ok: false, error: `读取助记符失败：${e.message || e}` }
  }
  // 按 latin1 往返，避免把原文件多字节注释弄坏
  const raw = rawBuf.toString('latin1')

  let patched
  try {
    patched = appendTestRungToMnemonic(raw, proposed)
  } catch (e) {
    return { ok: false, error: String(e.message || e), mnemonicPath: exp.mnemonicPath }
  }

  const editedPath = path.join(
    path.dirname(lad),
    `${path.basename(lad, path.extname(lad))}_mnemonic_edited.txt`,
  )
  fs.writeFileSync(editedPath, Buffer.from(patched.text, 'latin1'))

  // 每次结果都另存「原名_操作_时间戳.LAD」，绝不回报/覆盖成同一个 studer.LAD
  const outLad = buildNamedLadOutPath(lad, patched.name || 'EDIT')

  if (patched.skipped) {
    // 梯级已在工程里：不再假装“写回了 studer.LAD”，直接另存一份带时间戳的副本
    try {
      fs.copyFileSync(lad, outLad)
      const bytes = fs.statSync(outLad).size
      if (bytes < 100) {
        return {
          ok: false,
          error: `另存失败：\`${outLad}\` 仅 ${bytes} 字节`,
          ladPath: outLad,
          bytes,
          mnemonicPath: editedPath,
          name: patched.name,
          flag: patched.flag,
          input: patched.input,
          output: patched.output,
        }
      }
      return {
        ok: true,
        skipped: true,
        ladPath: outLad,
        sourceLadPath: lad,
        bytes,
        mnemonicPath: editedPath,
        alternate: true,
        message: '助记符中已有相同测试点，未重复追加梯级',
        note: [
          pathNote,
          `梯级已存在，未改内容；已另存副本（未覆盖 \`${lad}\`）`,
          normalized.note,
        ]
          .filter(Boolean)
          .join('；'),
        name: patched.name,
        flag: patched.flag,
        input: patched.input,
        output: patched.output,
      }
    } catch (e) {
      return {
        ok: false,
        error: `梯级已存在且另存失败：${e.message || e}`,
        mnemonicPath: editedPath,
        name: patched.name,
        flag: patched.flag,
        input: patched.input,
        output: patched.output,
      }
    }
  }

  // 默认不 Compile，缩短阻塞；写回成功即可
  const imp = await importMnemonicViaLadderIii(lad, editedPath, {
    fladderPath,
    compile: false,
    outPath: outLad,
  })
  if (!imp.ok) {
    return {
      ok: false,
      error: `MnemonicToSrc 写回失败：${imp.error || ''}（若 GUI 正打开同一 LAD，请先关掉再试）`,
      mnemonicPath: editedPath,
      backupPath: imp.backupPath,
      stashPath: imp.stashPath || '',
      bytes: imp.bytes || 0,
      log: imp.log,
      name: patched.name,
      flag: patched.flag,
      input: patched.input,
      output: patched.output,
    }
  }

  const resultPath = imp.ladPath || outLad
  let bytes = 0
  try {
    bytes = fs.statSync(resultPath).size
  } catch {
    bytes = 0
  }
  if (bytes < 100) {
    return {
      ok: false,
      error: `写回结果异常：\`${resultPath}\` 仅 ${bytes} 字节（不可用）`,
      ladPath: resultPath,
      bytes,
      mnemonicPath: editedPath,
      backupPath: imp.backupPath,
      log: imp.log,
      name: patched.name,
      flag: patched.flag,
      input: patched.input,
      output: patched.output,
    }
  }

  // 硬校验：成功结果绝不能仍是源工程同名路径（命名逻辑失效时直接报错）
  if (path.resolve(resultPath) === path.resolve(lad)) {
    return {
      ok: false,
      error: `内部错误：写回仍落在源文件 \`${lad}\`，未生成独立文件名。请重启 SAMA 后再试。`,
      ladPath: resultPath,
      bytes,
      mnemonicPath: editedPath,
      backupPath: imp.backupPath,
      log: imp.log,
      name: patched.name,
      flag: patched.flag,
      input: patched.input,
      output: patched.output,
    }
  }

  return {
    ok: true,
    ladPath: resultPath,
    sourceLadPath: lad,
    bytes,
    mnemonicPath: editedPath,
    backupPath: imp.backupPath,
    log: imp.log,
    compiled: imp.compiled,
    alternate: true,
    note: [
      pathNote,
      `已另存为新文件（未覆盖原工程 \`${lad}\`）`,
      normalized.note,
      imp.note || '',
    ]
      .filter(Boolean)
      .join('；'),
    name: patched.name,
    flag: patched.flag,
    input: patched.input,
    output: patched.output,
  }
}

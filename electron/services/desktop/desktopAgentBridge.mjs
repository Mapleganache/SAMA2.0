/**
 * Agent 侧：解析 sama-tool / sama-allow-desktop，执行 SAFE，CONFIRM 保留批准信息
 * Phase 3：多步计划 + 失败后观察再试一轮（有限）
 */
import { runDesktopTool } from './index.mjs'
import { inferPlanFromUser } from './taskRunner.mjs'
import { observeDesktop, summarizeObservation } from './observer.mjs'

/**
 * 从助手正文解析工具调用块
 */
export function parseDesktopToolBlocks(text) {
  const s = String(text || '')
  const out = []
  const re = /```(?:sama-tool|sama-allow-desktop)\s*\r?\n([\s\S]*?)```/gi
  let m
  while ((m = re.exec(s))) {
    const body = m[1].trim()
    try {
      const json = JSON.parse(body)
      if (json && json.tool) {
        out.push({
          tool: String(json.tool),
          args: json.args && typeof json.args === 'object' ? json.args : {},
          raw: m[0],
          allowMarker: /sama-allow-desktop/i.test(m[0]),
        })
      }
    } catch {
      /* 忽略坏 JSON */
    }
  }
  return out
}

/** 常见意图 → 工具（模型未吐标记时的兜底） */
export function inferDesktopToolsFromUser(userText) {
  const t = String(userText || '').trim()

  // 多步计划优先
  const plan = inferPlanFromUser(t)
  if (plan) {
    return [{ tool: 'desktop.runPlan', args: plan }]
  }

  const tools = []

  if (/打开\s*(记事本|notepad)/i.test(t) || /^(记事本|notepad)$/i.test(t)) {
    tools.push({ tool: 'application.launch', args: { name: 'notepad' } })
  }
  if (/打开\s*(计算器|calc)/i.test(t)) {
    tools.push({ tool: 'application.launch', args: { name: 'calc' } })
  }
  if (/打开\s*(木木|mumu)/i.test(t) && !/安装|\.apk/i.test(t)) {
    tools.push({ tool: 'emulator.open', args: { name: '木木模拟器' } })
  }

  const copy =
    t.match(
      /(?:把|将)?\s*[「"`]?([^」"`]+)[」"`]?\s*复制到\s*[「"`]?([^」"`]+)[」"`]?/i,
    ) || t.match(/copy\s+(.+?)\s+to\s+(.+)/i)
  if (copy) {
    tools.push({
      tool: 'file.copy',
      args: { source: copy[1].trim(), target: copy[2].trim() },
    })
  }

  const del = t.match(/(?:删除|删掉)\s*[「"`]?([^」"`]+)[」"`]?/i)
  if (del && !/LAD|梯形|允许/i.test(t)) {
    tools.push({ tool: 'file.delete', args: { path: del[1].trim() } })
  }

  if (/^(运行|执行)?\s*tasklist\s*$/i.test(t) || /执行.{0,6}tasklist/i.test(t)) {
    tools.push({ tool: 'shell.run', args: { command: 'tasklist', args: [] } })
  }

  if (/切换到|聚焦|激活/.test(t) && /(记事本|notepad|木木|mumu|计算器)/i.test(t)) {
    const name = t.match(/(记事本|notepad|木木模拟器|木木|mumu|计算器)/i)?.[1] || ''
    tools.push({ tool: 'window.focus', args: { title: name === '木木' ? 'MuMu' : name } })
  }

  if (/截图|screenshot/i.test(t) && !/OCR|识别文字/i.test(t)) {
    const win = t.match(/(?:截取|截图).{0,6}[「"`]?([^」"`]+)[」"`]?窗口/i)
    if (win) tools.push({ tool: 'screenshot.window', args: { title: win[1].trim() } })
    else tools.push({ tool: 'screenshot.screen', args: {} })
  }

  if (/观察桌面|看看(当前)?(有哪些)?窗口|desktop\.observe/i.test(t)) {
    tools.push({ tool: 'desktop.observe', args: { screenshot: /截图/.test(t) } })
  }

  if (/adb\s*devices|列出.{0,6}(adb)?设备/i.test(t)) {
    tools.push({ tool: 'adb.devices', args: {} })
  }

  // 单独安装 APK（无计划命中时）
  if (/安装/.test(t) && /\.apk/i.test(t) && !tools.some((x) => x.tool === 'desktop.runPlan')) {
    const apk =
      t.match(/((?:桌面|Desktop)[\\/][^\s"'`]+\.apk)/i)?.[1] ||
      t.match(/([A-Za-z]:\\[^\s"'`]+\.apk)/i)?.[1] ||
      t.match(/([^\s"'`]+\.apk)/i)?.[1]
    if (apk) {
      tools.push({
        tool: 'android.installApk',
        args: {
          apk,
          openEmulator: /(木木|mumu|模拟器)/i.test(t),
          emulator: '木木模拟器',
        },
      })
    }
  }

  if (/探测.{0,8}(梯子|ladder|机床软件|picture)|cnc\.probe|有没有.*(ladder|梯子|picture)/i.test(t)) {
    tools.push({ tool: 'cnc.probe', args: {} })
  }

  if (/列出.{0,8}(机床|cnc|梯子).{0,6}软件|cnc\.listApps/i.test(t)) {
    tools.push({ tool: 'cnc.listApps', args: {} })
  }

  if (/打开.{0,8}(picture|画面软件|FANUC\s*PICTURE)/i.test(t) && !/\.fp2|\.xml/i.test(t)) {
    tools.push({ tool: 'cnc.openApp', args: { name: 'picture' } })
  }

  if (/打开.{0,8}(ncguide|NCGuide|导程)/i.test(t)) {
    tools.push({ tool: 'cnc.openApp', args: { name: 'ncguide' } })
  }

  if (/备份/.test(t) && /\.(nc|cnc|mpf|gcode)/i.test(t) && !tools.some((x) => x.tool === 'desktop.runPlan')) {
    const nc =
      t.match(/((?:桌面|Desktop|文档|下载|workspace)[\\/][^\s"'`]+\.(?:nc|cnc|mpf|gcode))/i)?.[1] ||
      t.match(/([A-Za-z]:\\[^\s"'`]+\.(?:nc|cnc|mpf|gcode))/i)?.[1] ||
      t.match(/([^\s"'`]+\.(?:nc|cnc|mpf|gcode))/i)?.[1]
    if (nc) tools.push({ tool: 'cnc.backupNc', args: { source: nc } })
  }

  if (/\.lad\b/i.test(t) && /打开/.test(t) && !tools.some((x) => x.tool === 'desktop.runPlan')) {
    const lad =
      t.match(/((?:桌面|Desktop|文档|下载|workspace)[\\/][^\s"'`]+\.lad)/i)?.[1] ||
      t.match(/([A-Za-z]:\\[^\s"'`]+\.lad)/i)?.[1] ||
      t.match(/([^\s"'`]+\.lad)/i)?.[1]
    if (lad) tools.push({ tool: 'cnc.openLad', args: { lad } })
  }

  return tools
}

function formatToolResult(r) {
  if (r.requiresApproval) {
    return [
      `⏳ 需要确认：\`${r.tool}\``,
      `approvalId: \`${r.approvalId}\``,
      '```sama-allow-desktop',
      JSON.stringify(
        { tool: r.tool, args: r.preview?.args || {}, approvalId: r.approvalId },
        null,
        2,
      ),
      '```',
    ].join('\n')
  }
  if (r.success) {
    const summary = JSON.stringify(r.data, null, 2)
    return `✅ \`${r.tool}\` 成功（${r.durationMs}ms）\n\`\`\`json\n${summary.slice(0, 4000)}\n\`\`\``
  }
  return `❌ \`${r.tool}\` 失败：${r.error?.code || ''} ${r.error?.message || ''}`
}

/**
 * 失败后：观察 → 对可重试的 SAFE 工具再试一次
 */
async function observeAndRetryFailed(desktopOps) {
  const failed = desktopOps.filter((r) => !r.success && !r.requiresApproval)
  if (!failed.length) return []

  const obs = await observeDesktop({ screenshot: false })
  const extra = []
  extra.push({
    success: true,
    tool: 'desktop.observe',
    data: { summary: summarizeObservation(obs), windowCount: obs.windowCount },
    durationMs: obs.durationMs,
    permission: 'SAFE',
    retryPhase: true,
  })

  for (const f of failed.slice(0, 3)) {
    // 仅自动重试明显可恢复的 SAFE 工具
    if (!['application.launch', 'window.focus', 'screenshot.window', 'screenshot.screen'].includes(f.tool)) {
      continue
    }
    const args = f.preview?.args || {}
    // 从原失败结果无法取 args —— 存在 desktopOps 时我们没存 args。跳过若无 args。
    // 调用方传入 originalBlocks 更好；这里用 observe 后对 window.focus 做标题兜底
    if (f.tool === 'window.focus') {
      const r = await runDesktopTool({
        tool: 'window.focus',
        args: { title: 'Notepad' },
        approved: false,
      })
      r.retryPhase = true
      extra.push(r)
    }
  }
  return extra
}

/**
 * 在 Agent 回合末尾执行桌面工具（Ask 模式不调用）。
 */
export async function applyDesktopToolsFromAgent({ mode, userText, content }) {
  if (mode !== 'agent') {
    return { content, desktopOps: [] }
  }

  let blocks = parseDesktopToolBlocks(content)
  if (!blocks.length) {
    const inferred = inferDesktopToolsFromUser(userText)
    blocks = inferred.map((x) => ({
      ...x,
      raw: '',
      allowMarker: getToolNeedsAllow(x.tool, x.args),
    }))
  }

  if (!blocks.length) return { content, desktopOps: [] }

  const desktopOps = []
  const lines = []

  for (const b of blocks) {
    const r = await runDesktopTool({
      tool: b.tool,
      args: b.args,
      approved: false,
    })
    // 保留 args 便于重试
    r._args = b.args
    desktopOps.push(r)
    lines.push(formatToolResult(r))
  }

  // Phase 3：失败后观察 + 有限重试
  const hasHardFail = desktopOps.some((r) => !r.success && !r.requiresApproval)
  if (hasHardFail) {
    const obs = await observeDesktop({ screenshot: false })
    lines.push(
      `🔎 观察（失败后）\n前台: ${obs.activeWindow?.title || '（无）'}\n${summarizeObservation(obs)}`,
    )
    for (const f of desktopOps) {
      if (f.success || f.requiresApproval || !f._args) continue
      if (!['application.launch', 'window.focus', 'screenshot.window', 'screenshot.screen', 'desktop.runPlan'].includes(f.tool)) {
        continue
      }
      // runPlan 已有内部 retry；其它工具再试 1 次，必要时换 fallback args
      const retryArgs =
        f.tool === 'window.focus' && /记事本/.test(JSON.stringify(f._args))
          ? { title: 'Notepad' }
          : f.tool === 'screenshot.window' && /记事本/.test(JSON.stringify(f._args))
            ? { title: 'Notepad' }
            : f._args
      const r2 = await runDesktopTool({ tool: f.tool, args: retryArgs, approved: false })
      r2.retryPhase = true
      desktopOps.push(r2)
      lines.push(`↻ 重试 ${formatToolResult(r2)}`)
    }
  }

  let next = String(content || '')
  if (desktopOps.some((r) => r.tool === 'application.launch' || r.tool === 'desktop.runPlan')) {
    next = next.replace(/已经打开了[。.!！]?/g, '')
  }

  const footer = `\n\n---\n【Desktop 工具结果】\n${lines.join('\n\n')}`
  if (!/【Desktop 工具结果】/.test(next)) {
    next = `${next.trim()}${footer}`
  }

  return { content: next, desktopOps }
}

function getToolNeedsAllow(tool, args) {
  if (tool === 'file.delete') return true
  if (tool === 'desktop.runPlan' && args?.dryRun) return false
  return false
}

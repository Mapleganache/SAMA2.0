/** Desktop 允许卡：解析 sama-allow-desktop / Desktop 工具结果中的 CONFIRM */

export type DesktopToolCall = {
  tool: string
  args: Record<string, unknown>
  approvalId?: string
}

export type DetectedDesktopAllow = {
  isAllowAsk: boolean
  calls: DesktopToolCall[]
  title: string
  detail: string
}

export function parseDesktopAllowMarkers(text: string): DesktopToolCall[] {
  const s = String(text || '')
  const out: DesktopToolCall[] = []
  const re = /```sama-allow-desktop\s*\r?\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) {
    try {
      const json = JSON.parse(m[1].trim())
      if (json?.tool) {
        out.push({
          tool: String(json.tool),
          args: json.args && typeof json.args === 'object' ? json.args : {},
          approvalId: json.approvalId ? String(json.approvalId) : undefined,
        })
      }
    } catch {
      /* ignore */
    }
  }
  // 也接受结果区里的 approvalId 提示
  if (!out.length) {
    const id = s.match(/approvalId:\s*`?(desk-[a-z0-9-]+)`?/i)?.[1]
    const tool = s.match(/需要确认：\s*`([^`]+)`/i)?.[1]
    if (id && tool) {
      out.push({ tool, args: {}, approvalId: id })
    }
  }
  return out
}

export function looksLikeDesktopAllowAsk(text: string): boolean {
  const s = String(text || '')
  if (/已按你的允许|Desktop 操作已执行|已拒绝 Desktop/i.test(s)) return false
  if (/sama-allow-desktop/i.test(s)) return true
  if (/需要确认：\s*`[^`]+`/i.test(s) && /approvalId:/i.test(s)) return true
  if (/【Desktop 工具结果】/i.test(s) && /需要确认|NEED_ALLOW/i.test(s)) return true
  return false
}

export function detectDesktopAllowRequest(text: string): DetectedDesktopAllow {
  const calls = parseDesktopAllowMarkers(text)
  const isAllowAsk = looksLikeDesktopAllowAsk(text) && calls.length > 0
  const first = calls[0]
  const title = first
    ? `允许 Desktop 操作：${first.tool}？`
    : '允许 Desktop 操作？'
  const detail = first
    ? `工具 \`${first.tool}\`\n参数：${JSON.stringify(first.args || {}, null, 0).slice(0, 400)}`
    : '需要确认后才能继续'
  return { isAllowAsk, calls, title, detail }
}

export function desktopKindTitle(tool: string): string {
  if (tool === 'file.delete') return '允许删除文件？'
  if (tool === 'file.write') return '允许覆盖写入文件？'
  if (tool === 'application.terminate') return '允许结束进程？'
  if (tool === 'window.close') return '允许关闭窗口？'
  if (tool === 'shell.run') return '允许执行 Shell 命令？'
  if (tool === 'ui.click' || tool === 'ui.clickElement') return '允许点击界面元素？'
  if (tool === 'desktop.runPlan') return '允许执行多步桌面计划？'
  if (tool === 'android.installApk' || tool === 'adb.install') return '允许安装 Android APK？'
  if (tool === 'adb.uninstall') return '允许卸载 Android 应用？'
  if (tool === 'adb.launch') return '允许启动 Android 应用？'
  if (tool === 'adb.shell' || tool === 'adb.push') return '允许执行 ADB 操作？'
  if (tool.startsWith('cnc.')) return '允许执行机床软件桌面操作？'
  if (tool.startsWith('mouse.')) return '允许模拟鼠标操作？'
  if (tool.startsWith('keyboard.')) return '允许模拟键盘输入？'
  return `允许 Desktop：${tool}？`
}

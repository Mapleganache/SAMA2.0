/**
 * Windows UI Automation（System.Windows.Automation via PowerShell）
 * 优先按 Name / AutomationId / ControlType 查找，再 Invoke/点击。
 */
import { spawnSync } from 'node:child_process'
import { mouseClick } from './inputManager.mjs'
import { windowList, windowFocus } from './windowManager.mjs'

function runPs(script, timeoutMs = 25000) {
  const r = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-STA', '-Command', script],
    { encoding: 'utf8', windowsHide: true, timeout: timeoutMs },
  )
  return {
    status: r.status,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
    error: r.error,
  }
}

const UIA_BOOT = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
`

function findWindowHandle(args = {}) {
  if (args.handle) return Number(args.handle)
  const title = String(args.window || args.windowTitle || args.title || '').trim()
  if (!title) return null
  const list = windowList().windows || []
  const lower = title.toLowerCase()
  const hits = list.filter((w) => String(w.title || '').toLowerCase().includes(lower))
  hits.sort((a, b) => String(a.title).length - String(b.title).length)
  return hits[0] ? Number(hits[0].handle) : null
}

/**
 * 列出窗口下可见控件（限深限量，避免爆炸）
 */
export function uiTree(args = {}) {
  const handle = findWindowHandle(args)
  if (!handle) {
    const err = new Error('ui.tree 需要 window/title 或 handle')
    err.code = 'WINDOW_REQUIRED'
    throw err
  }
  try {
    windowFocus({ handle })
  } catch {
    /* ignore */
  }
  const max = Math.min(Number(args.limit) || 80, 200)
  const script = `
${UIA_BOOT}
$hwnd = [IntPtr]${handle}
$root = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
if (-not $root) { 'ERR:NO_ROOT'; exit 1 }
$cond = [System.Windows.Automation.Condition]::TrueCondition
$walker = New-Object System.Windows.Automation.TreeWalker([System.Windows.Automation.Automation]::ControlViewCondition)
$list = New-Object System.Collections.Generic.List[object]
function Walk($el, $depth) {
  if ($script:list.Count -ge ${max}) { return }
  if ($depth -gt 8) { return }
  try {
    $name = $el.Current.Name
    $id = $el.Current.AutomationId
    $ctype = $el.Current.ControlType.ProgrammaticName
    $rect = $el.Current.BoundingRectangle
    if (-not [string]::IsNullOrWhiteSpace($name) -or -not [string]::IsNullOrWhiteSpace($id)) {
      $script:list.Add([pscustomobject]@{
        name = $name
        automationId = $id
        controlType = $ctype
        x = [int]($rect.X + $rect.Width/2)
        y = [int]($rect.Y + $rect.Height/2)
        width = [int]$rect.Width
        height = [int]$rect.Height
        depth = $depth
      })
    }
  } catch {}
  $child = $walker.GetFirstChild($el)
  while ($child -ne $null -and $script:list.Count -lt ${max}) {
    Walk $child ($depth+1)
    $child = $walker.GetNextSibling($child)
  }
}
Walk $root 0
@{ handle=${handle}; count=$list.Count; elements=$list } | ConvertTo-Json -Compress -Depth 5
`
  const r = runPs(script)
  if (/ERR:NO_ROOT/.test(r.stdout)) {
    const err = new Error('无法从句柄获取 AutomationElement（可能不是标准 Win32/WPF 窗口）')
    err.code = 'UIA_ROOT_FAILED'
    throw err
  }
  try {
    const data = JSON.parse(r.stdout.trim() || '{}')
    if (!Array.isArray(data.elements) && data.elements) data.elements = [data.elements]
    return data
  } catch (e) {
    const err = new Error(`解析 UI 树失败: ${r.stderr || r.stdout.slice(0, 300)}`)
    err.code = 'UIA_PARSE_FAILED'
    throw err
  }
}

/**
 * 按名称 / AutomationId / 描述查找元素
 */
export function uiFind(args = {}) {
  const name = String(args.name || args.description || args.query || args.text || '').trim()
  const automationId = String(args.automationId || args.id || '').trim()
  if (!name && !automationId) {
    const err = new Error('ui.find 需要 name/description 或 automationId')
    err.code = 'QUERY_REQUIRED'
    throw err
  }
  const handle = findWindowHandle(args)
  const treeArgs = handle ? { handle, limit: args.limit || 120 } : null
  let elements = []
  if (treeArgs) {
    const tree = uiTree(treeArgs)
    elements = tree.elements || []
  } else {
    // 无窗口：扫前台根（桌面）— 可能很慢，限量
    const script = `
${UIA_BOOT}
$root = [System.Windows.Automation.AutomationElement]::RootElement
$walker = New-Object System.Windows.Automation.TreeWalker([System.Windows.Automation.Automation]::ControlViewCondition)
$list = New-Object System.Collections.Generic.List[object]
$needle = '${name.replace(/'/g, "''")}'
$idNeedle = '${automationId.replace(/'/g, "''")}'
function Walk($el, $depth) {
  if ($script:list.Count -ge 60) { return }
  if ($depth -gt 5) { return }
  try {
    $n = $el.Current.Name
    $id = $el.Current.AutomationId
    $hit = $false
    if ($idNeedle -and $id -eq $idNeedle) { $hit = $true }
    if ($needle -and $n -and ($n -eq $needle -or $n.Contains($needle))) { $hit = $true }
    if ($hit) {
      $rect = $el.Current.BoundingRectangle
      $script:list.Add([pscustomobject]@{
        name=$n; automationId=$id; controlType=$el.Current.ControlType.ProgrammaticName
        x=[int]($rect.X+$rect.Width/2); y=[int]($rect.Y+$rect.Height/2)
        width=[int]$rect.Width; height=[int]$rect.Height
      })
    }
  } catch {}
  $child = $walker.GetFirstChild($el)
  while ($child -ne $null -and $script:list.Count -lt 60) {
    Walk $child ($depth+1)
    $child = $walker.GetNextSibling($child)
  }
}
Walk $root 0
@{ count=$list.Count; elements=$list } | ConvertTo-Json -Compress -Depth 4
`
    const r = runPs(script, 35000)
    try {
      const data = JSON.parse(r.stdout.trim() || '{}')
      elements = Array.isArray(data.elements) ? data.elements : data.elements ? [data.elements] : []
    } catch {
      elements = []
    }
  }

  const lower = name.toLowerCase()
  let matches = elements.filter((el) => {
    if (automationId && String(el.automationId || '') === automationId) return true
    if (!name) return false
    const n = String(el.name || '')
    return n === name || n.toLowerCase().includes(lower)
  })
  // 精确优先
  matches.sort((a, b) => {
    const ae = String(a.name) === name ? 0 : 1
    const be = String(b.name) === name ? 0 : 1
    return ae - be || String(a.name).length - String(b.name).length
  })

  if (!matches.length) {
    return {
      found: false,
      query: { name, automationId },
      matches: [],
      source: 'uia',
    }
  }
  const best = matches[0]
  return {
    found: true,
    query: { name, automationId },
    element: best,
    x: best.x,
    y: best.y,
    confidence: String(best.name) === name ? 0.95 : 0.75,
    matches: matches.slice(0, 8),
    source: 'uia',
  }
}

/**
 * 点击命名控件：UIA InvokePattern 优先，否则中心坐标点击
 */
export function uiClick(args = {}) {
  const found = uiFind(args)
  if (!found.found) {
    const err = new Error(`未找到控件: ${args.name || args.description || args.automationId}`)
    err.code = 'UI_ELEMENT_NOT_FOUND'
    err.data = found
    throw err
  }
  const handle = findWindowHandle(args)
  if (handle) {
    try {
      windowFocus({ handle })
    } catch {
      /* ignore */
    }
  }
  // 尝试 Invoke
  const name = String(args.name || args.description || found.element?.name || '').replace(/'/g, "''")
  const autoId = String(args.automationId || found.element?.automationId || '').replace(/'/g, "''")
  const invokeScript = `
${UIA_BOOT}
$root = ${handle ? `[System.Windows.Automation.AutomationElement]::FromHandle([IntPtr]${handle})` : '[System.Windows.Automation.AutomationElement]::RootElement'}
$cond = $null
if ('${autoId}') {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::AutomationIdProperty, '${autoId}')
} else {
  $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${name}')
}
$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if (-not $el) { 'MISS'; exit 0 }
try {
  $inv = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $inv.Invoke()
  'INVOKED'
} catch {
  'NO_INVOKE'
}
`
  const r = runPs(invokeScript)
  if (/INVOKED/.test(r.stdout)) {
    return { clicked: true, method: 'uia-invoke', element: found.element, x: found.x, y: found.y }
  }
  // fallback 坐标
  mouseClick({ x: found.x, y: found.y, button: 'left', clicks: 1 })
  return { clicked: true, method: 'mouse-center', element: found.element, x: found.x, y: found.y }
}

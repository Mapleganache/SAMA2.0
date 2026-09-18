/** 从助手消息识别「需要用户点允许」的各类申请（Cursor 风格：逐项排队） */

export type AllowActionKind = 'open-ladder' | 'edit-lad' | 'export-analyze' | 'generate-lad'

export type ProposedLadEdit = {
  name?: string
  input?: string
  output?: string
  note?: string
}

export type DetectedAllow = {
  isAllowAsk: boolean
  /** 已按执行顺序排列，一次只应弹一项 */
  kinds: AllowActionKind[]
  ladPath: string
  title: string
  proposed?: ProposedLadEdit
}

const KIND_ORDER: AllowActionKind[] = [
  'generate-lad',
  'edit-lad',
  'open-ladder',
  'export-analyze',
]

/** 从正文抽出 .LAD 绝对路径 */
export function extractLadPathFromText(text: string): string {
  const s = String(text || '')
  const m =
    s.match(
      /sama-allow-(?:ladder|lad-edit|export|lad-generate)\s+path=["']([^"']+\.LAD)["']/i,
    ) ||
    s.match(/([A-Za-z]:\\[^\s"'`<>|*?]+\.LAD)\b/i) ||
    s.match(/(\\\\[^\s"'`<>|*?]+\.LAD)\b/i) ||
    s.match(/`([^`]+\.LAD)`/i)
  return m?.[1]?.replace(/\\\\/g, '\\') || ''
}

export function extractElkPathFromText(_text: string): string {
  return ''
}

/** 用户正文是否带显式写入标记（以用户参数为准，防模型回成 TEST_BTN） */
export function hasExplicitLadEditMarker(text: string): boolean {
  return /sama-allow-lad-edit\b/i.test(String(text || ''))
}

export function parseProposed(text: string): ProposedLadEdit | undefined {
  const s = String(text || '')
  const marker = s.match(
    /sama-allow-lad-edit\s+path=["'][^"']+["'](?:\s+name=["']([^"']*)["'])?(?:\s+in=["']([^"']*)["'])?(?:\s+out=["']([^"']*)["'])?/i,
  )
  if (marker) {
    return {
      name: marker[1] || undefined,
      input: marker[2] || undefined,
      output: marker[3] || undefined,
    }
  }
  const name =
    s.match(/按钮名称\s*[|｜]?\s*`?([A-Z0-9_]+)`?/i)?.[1] ||
    s.match(/`([A-Z][A-Z0-9_]{2,})`\s*[（(]?测试按钮/)?.[1] ||
    s.match(/名称[：:]\s*`?([A-Z0-9_]+)`?/i)?.[1]
  const input =
    s.match(/输入地址\s*[|｜]?\s*`?(X\d+\.\d)`?/i)?.[1] ||
    s.match(/`?(X\d+\.\d)`?\s*[（(]?预留/)?.[1]
  const output =
    s.match(/(?:置位|标志位|输出)\s*`?(R\d+\.\d)`?/i)?.[1] ||
    s.match(/`?(R\d+\.\d)`?\s*[（(]?测试标志/)?.[1]
  if (name || input || output) return { name, input, output }
  return undefined
}

/** 是否像「要用户点允许」的申请文（排除已经执行完的回执） */
export function looksLikeAnyAllowAsk(text: string): boolean {
  const s = String(text || '')
  // 执行结果 / 回执，不再当成新申请
  if (
    /修改方案已写入|已按脚本写入 LAD|已写入梯形工程|未追加新梯级|已另存副本|已按你的允许处理|已允许并打开|允许后处理结果|下一项权限|已拒绝剩余权限|脚本写回失败|脚本写回未成功|写入步骤已完成|本步已完成|已打开 LADDER-III|已生成演示梯形|演示工程已生成/i.test(
      s,
    )
  ) {
    return false
  }
  if (/sama-allow-(?:ladder|lad-edit|export|lad-generate)/i.test(s)) return true
  if (/按钮添加申请|修改申请|编译申请|下载申请|权限申请|打开权限申请|生成演示申请/i.test(s))
    return true
  if (/需要您确认|请确认[：:].*允许|是否允许我|若允许，请/i.test(s)) return true
  if (/请回复[「「"]?允许/i.test(s)) return true
  if (/LADDER-III|LADDER\s*III|Fladder|\.LAD/i.test(s) && /允许|权限|申请/i.test(s)) {
    return true
  }
  if (/修改\s*`?[^`]*\.LAD`?/i.test(s) && /允许|确认/i.test(s)) return true
  if (/(生成|新建).{0,12}(演示)?(梯形|LAD)/i.test(s) && /允许|确认|点击/i.test(s)) return true
  return false
}

/** 按依赖顺序排出要申请的项；不一次塞满无关操作 */
function detectKinds(text: string): AllowActionKind[] {
  const s = String(text || '')
  const set = new Set<AllowActionKind>()

  const wantsGenerate =
    /sama-allow-lad-generate\b/i.test(s) ||
    ((/(生成|新建|创建).{0,12}(演示)?(梯形|LAD)(工程|文件|图)?/i.test(s) ||
      /(设计|写).{0,8}(一套|一个).{0,8}(复杂)?(梯形|LAD)/i.test(s)) &&
      !/(报告|分析|核验)/.test(s))

  const wantsEdit =
    /sama-allow-lad-edit\b/i.test(s) ||
    /按钮添加|添加申请|修改\s*.*\.LAD|添加该按钮|改梯形|写入符号|是否允许我修改|允许写入|写入标记|脚本写入/i.test(
      s,
    )

  const wantsExport =
    /sama-allow-export\b/i.test(s) ||
    /导出助记符|出报告|互锁核验|分析报告/i.test(s)

  const wantsOpen =
    /sama-allow-ladder\b/i.test(s) ||
    /打开\s*LADDER|启动\s*LADDER|打开软件|打开梯子/i.test(s)

  // 生成演示工程：单独一项（基于模板外壳，非从零空工程）
  if (wantsGenerate && !wantsEdit) {
    set.add('generate-lad')
    return KIND_ORDER.filter((k) => set.has(k))
  }

  // 模型常错用 sama-allow-ladder 冒充「写入」：文案含写入却只有打开标记时，仍排队写入
  if (wantsEdit || (/写入|改梯形|测试按钮|TEST_BTN/i.test(s) && wantsOpen)) {
    set.add('edit-lad')
    set.add('open-ladder')
    if (wantsExport) set.add('export-analyze')
  } else if (wantsExport) {
    set.add('export-analyze')
  } else if (wantsOpen) {
    set.add('open-ladder')
  } else if (looksLikeAnyAllowAsk(s)) {
    set.add('open-ladder')
  }

  return KIND_ORDER.filter((k) => set.has(k))
}

export function kindTitle(kind: AllowActionKind, proposed?: ProposedLadEdit): string {
  if (kind === 'open-ladder') return '允许打开 FANUC LADDER-III？'
  if (kind === 'export-analyze') return '允许导出助记符并生成报告？'
  if (kind === 'generate-lad') return '允许基于模板生成演示 LAD？'
  const name = proposed?.name
  return name ? `允许脚本写入 LAD（${name}）？` : '允许脚本写入 LAD（追加测试梯级）？'
}

export function kindDetail(kind: AllowActionKind, proposed?: ProposedLadEdit): string {
  if (kind === 'open-ladder') {
    return '仅启动本机 LADDER-III 并打开该 .LAD。不会改梯形、不会写文件。'
  }
  if (kind === 'export-analyze') {
    return '调用 LADDER-III 命令行导出助记符，并生成问题分析报告到 LAD 同目录。'
  }
  if (kind === 'generate-lad') {
    return '基于现有 0i 工程外壳（不覆盖模板）追加演示梯级，写出新的桌面 .LAD。不是从零空工程。请先关掉 LADDER-III。禁止下载到真实机床。'
  }
  const name = proposed?.name || 'TEST_BTN'
  const input = proposed?.input || 'X0.1'
  const output = proposed?.output || 'R100.0'
  return `与 Cursor 改代码一样走脚本：SrcToMnemonic → 追加 ${name}（${input}→${output}）→ MnemonicToSrc。请先关掉 LADDER-III。地址须在本机 PMC 合法范围内（0i-F 上 X1000/R9000 常非法）。`
}

export function detectAllowRequest(text: string, fallbackLadPath = ''): DetectedAllow {
  const isAllowAsk = looksLikeAnyAllowAsk(text)
  const kinds = isAllowAsk ? detectKinds(text) : []
  const lad = extractLadPathFromText(text)
  const ladPath = lad || fallbackLadPath || ''
  const proposed = parseProposed(text)
  const title =
    kinds.length > 1
      ? `需要逐项允许（共 ${kinds.length} 步）`
      : kinds[0]
        ? kindTitle(kinds[0], proposed)
        : '需要你的允许'

  return { isAllowAsk, kinds, ladPath, title, proposed }
}

/**
 * 助手回错标记（如 TEST_BTN）时，用上一轮用户显式 sama-allow-lad-edit 覆盖路径与地址。
 */
export function preferUserExplicitEdit(
  assistantText: string,
  userText: string,
  fallbackLadPath = '',
): DetectedAllow {
  const fromAssistant = detectAllowRequest(assistantText, fallbackLadPath)
  if (!hasExplicitLadEditMarker(userText)) return fromAssistant
  const fromUser = detectAllowRequest(userText, fallbackLadPath)
  if (!fromUser.kinds.includes('edit-lad') && !fromUser.proposed) return fromAssistant

  const proposed = fromUser.proposed || fromAssistant.proposed
  const ladPath = fromUser.ladPath || fromAssistant.ladPath || fallbackLadPath
  return {
    isAllowAsk: true,
    kinds: ['edit-lad'],
    ladPath,
    proposed,
    title: kindTitle('edit-lad', proposed),
  }
}

export function buildEditProposalMarkdown(
  ladPath: string,
  proposed?: ProposedLadEdit,
): string {
  const name = proposed?.name || 'TEST_BTN'
  const input = proposed?.input || 'X0.1'
  const output = proposed?.output || 'R100.0'
  return `# LAD 写入说明（备忘，主成果是 .LAD）

> 真正改动的是梯形工程 \`.LAD\`（助记符 → MnemonicToSrc）。本 md 只是文字记录，可忽略。

- 目标工程：\`${ladPath}\`
- 符号：\`${name}\`
- 输入：\`${input}\`
- 置位：\`${output}\`

## 写入步骤

1. \`SrcToMnemonic\` 导出助记符  
2. 追加测试梯级  
3. \`MnemonicToSrc\` 写回  
4. 备份 \`*.bak-sama-*\`

## 梯形

\`\`\`
RD  ${input}  ; ${name}
WRT ${output} ; ${name}_FLAG
\`\`\`

生成时间：${new Date().toISOString()}
`
}

import { memo, useCallback, useEffect, useMemo, useState, type MouseEvent } from 'react'
import type { KbSource, Message } from '../data'
import { detectAllowRequest } from '../ladAllow'
import { IndustrialSampleView, type IndustrialPreview } from './IndustrialSampleView'
import { extractNcFromAssistant } from '../gcode/extractNc'

const FILE_OP_LINE =
  /^[✓✔]\s*已(?:创建|保存)[：:]\s*(.+?)\s*（\d+\s*字节）(?:\s*\[本机\])?(?:\s*（双击打开）)?\s*$/

function extractPathFromLine(line: string): string | null {
  const m = String(line || '').match(FILE_OP_LINE)
  return m?.[1]?.trim() || null
}

/** 复制用：去掉内部权限标记，保留可读正文 */
function copyableText(content: string): string {
  let s = String(content || '')
  s = s.replace(/```sama-allow-[\w-]*\s*\r?\n[\s\S]*?```/gi, '')
  s = s.replace(/^[ \t]*sama-allow-[\w-]+[^\n]*$/gim, '')
  const footerIdx = s.split('\n').findIndex((l) => /【文件操作结果】|【LAD 事实报告/.test(l))
  if (footerIdx >= 0) {
    s = s.split('\n').slice(0, Math.max(0, footerIdx - 1)).join('\n')
  }
  return s.replace(/\n{3,}/g, '\n\n').trim()
}

async function writeClipboard(text: string): Promise<boolean> {
  if (!text) return false
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  } catch {
    return false
  }
}

function sourcesFromMessage(msg: Message): KbSource[] {
  if (msg.sources?.length) return msg.sources
  if (!msg.citations?.length) return []
  return msg.citations.map((c, i) => {
    const parts = String(c).split(/\s*\/\s*/)
    return {
      n: i + 1,
      brand: parts[0] || '资料',
      source: parts.slice(1).join(' / ') || String(c),
      title: parts.slice(1).join(' / ') || String(c),
    }
  })
}

function renderCitedText(
  text: string,
  sourceNs: Set<number>,
  onCiteClick: (n: number) => void,
) {
  const parts = String(text || '').split(/(\[\d+\])/g)
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/)
    if (m) {
      const n = Number(m[1])
      if (sourceNs.has(n)) {
        return (
          <button
            key={`c-${i}`}
            type="button"
            className="cite-inline"
            title={`查看引用 [${n}]`}
            onClick={() => onCiteClick(n)}
          >
            [{n}]
          </button>
        )
      }
    }
    return <span key={`t-${i}`}>{part}</span>
  })
}

export { extractLadPathFromText, looksLikeAnyAllowAsk as looksLikeLadderAllowAsk } from '../ladAllow'

type Props = {
  msg: Message
  onOpenPath: (filePath: string) => void
  fallbackLadPath?: string
  /** 输入区是否正在显示允许卡 */
  allowCardActive?: boolean
  allowQueueLen?: number
  /** 该条申请已处理完：不再显示「请允许」提示 */
  allowSettled?: boolean
  /** 该条消息已完成的权限种类 */
  completedAllowKinds?: string[]
  /** 把某条引用加入追问 */
  onAskAboutSource?: (source: KbSource) => void
  /** 加工页：回答含 G 代码时显示「生成 G 代码文件」 */
  showGcodeFileButton?: boolean
  onSaveGcodeFile?: (nc: string) => Promise<boolean>
}

type CtxMenu = { x: number; y: number; selection: string }

/** 长正文整块渲染；权限确认改由输入区单卡逐项弹出 */
export const MessageBody = memo(function MessageBody({
  msg,
  onOpenPath,
  fallbackLadPath,
  allowCardActive,
  allowQueueLen = 0,
  allowSettled = false,
  completedAllowKinds = [],
  onAskAboutSource,
  showGcodeFileButton = false,
  onSaveGcodeFile,
}: Props) {
  const [copied, setCopied] = useState(false)
  const [gcodeSaved, setGcodeSaved] = useState(false)
  const [gcodeBusy, setGcodeBusy] = useState(false)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [openCite, setOpenCite] = useState<number | null>(null)
  const lines = msg.content.split('\n')
  const structured = (msg.fileOps || []).filter(
    (op) => op.ok !== false && op.path && !( /\.lad$/i.test(op.path) && (op.bytes ?? 0) < 100 ),
  )
  const footerIdx = lines.findIndex((l) => /【文件操作结果】|【LAD 事实报告/.test(l))
  const mainText = (footerIdx >= 0 ? lines.slice(0, Math.max(0, footerIdx - 1)) : lines).join('\n')
  const footerLines = footerIdx >= 0 ? lines.slice(footerIdx) : []
  const sources = useMemo(() => sourcesFromMessage(msg), [msg])
  const sourceNs = useMemo(() => new Set(sources.map((s) => s.n)), [sources])
  const fullCopyText =
    msg.role === 'assistant'
      ? copyableText(msg.content) || mainText.trim()
      : String(msg.content || '').trim()
  const canCopy = Boolean(fullCopyText)
  const ncSnippet = useMemo(
    () => (showGcodeFileButton && msg.role === 'assistant' ? extractNcFromAssistant(msg.content) : ''),
    [showGcodeFileButton, msg.role, msg.content],
  )

  useEffect(() => {
    setGcodeSaved(false)
  }, [msg.content])

  const detected = detectAllowRequest(msg.content, fallbackLadPath || '')
  const doneSet = new Set(completedAllowKinds)
  const pendingKinds = detected.kinds.filter((k) => !doneSet.has(k))
  const showHint =
    msg.role === 'assistant' &&
    detected.isAllowAsk &&
    pendingKinds.length > 0 &&
    !allowSettled &&
    (allowCardActive || allowQueueLen > 0)

  const openFromLine = useCallback(
    (line: string) => {
      const p = extractPathFromLine(line)
      if (p) onOpenPath(p)
    },
    [onOpenPath],
  )

  const saveGcodeFile = useCallback(async () => {
    if (!ncSnippet || !onSaveGcodeFile || gcodeBusy) return
    setGcodeBusy(true)
    try {
      const ok = await onSaveGcodeFile(ncSnippet)
      if (ok) setGcodeSaved(true)
    } finally {
      setGcodeBusy(false)
    }
  }, [ncSnippet, onSaveGcodeFile, gcodeBusy])

  const flashCopied = useCallback(() => {
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }, [])

  const copyAnswer = useCallback(
    async (override?: string) => {
      const text = (override ?? fullCopyText).trim()
      if (!text) return
      const ok = await writeClipboard(text)
      if (ok) flashCopied()
      setCtxMenu(null)
    },
    [fullCopyText, flashCopied],
  )

  const onContextMenu = useCallback(
    (e: MouseEvent) => {
      if (!canCopy && !window.getSelection()?.toString()) return
      e.preventDefault()
      e.stopPropagation()
      const selection = window.getSelection()?.toString() || ''
      setCtxMenu({ x: e.clientX, y: e.clientY, selection })
    },
    [canCopy],
  )

  useEffect(() => {
    if (!ctxMenu) return
    const close = () => setCtxMenu(null)
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') close()
    }
    window.addEventListener('click', close)
    window.addEventListener('scroll', close, true)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('keydown', onKey)
    }
  }, [ctxMenu])

  const focusCite = useCallback((n: number) => {
    setOpenCite(n)
    window.requestAnimationFrame(() => {
      document.getElementById(`cite-card-${msg.id}-${n}`)?.scrollIntoView({
        block: 'nearest',
        behavior: 'smooth',
      })
    })
  }, [msg.id])

  return (
    <div
      className="msg-body"
      onContextMenu={onContextMenu}
      title={msg.role === 'system' ? undefined : '右键可复制'}
    >
      {structured.length > 0 && (
        <div className="file-ops-panel">
          <div className="file-ops-title">生成的文件（双击打开）</div>
          <ul className="file-ops-list">
            {structured.map((op) => (
              <li key={op.path}>
                <button
                  type="button"
                  className="file-op-item"
                  title="双击在 SAMA 阅读区打开"
                  onDoubleClick={() => onOpenPath(op.path)}
                >
                  <span className="file-op-badge">
                    {/\.lad$/i.test(op.path)
                      ? 'LAD工程'
                      : /写入说明|修改方案/i.test(op.path)
                        ? '文字备忘'
                        : op.created
                          ? '新建'
                          : '保存'}
                  </span>
                  <span className="file-op-path">{op.path}</span>
                  {op.bytes != null && <span className="file-op-bytes">{op.bytes} 字节</span>}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {msg.plcSample ? (
        <IndustrialSampleView preview={msg.plcSample as IndustrialPreview} />
      ) : mainText ? (
        <div className="msg-text-block">
          {msg.role === 'assistant' && sources.length
            ? renderCitedText(mainText, sourceNs, focusCite)
            : mainText}
        </div>
      ) : null}
      {showHint ? (
        <div className="msg-allow-ladder">
          <div className="msg-allow-ladder-title">
            {`${detected.title} · 请看下方输入区的允许卡`}
          </div>
          <p className="ladder-allow-hint">
            {`输入区正在确认（队列剩余 ${Math.max(allowQueueLen, pendingKinds.length)} 步）。`}
          </p>
        </div>
      ) : null}
      {footerLines.length > 0 && (
        <div className="msg-footer-ops">
          {footerLines.map((line, i) => {
            const path = extractPathFromLine(line)
            if (path) {
              return (
                <p
                  key={i}
                  className="file-op-line"
                  title="双击在 SAMA 阅读区打开"
                  onDoubleClick={() => openFromLine(line)}
                >
                  {line || '\u00A0'}
                </p>
              )
            }
            return (
              <p key={i} className={line.startsWith('---') ? 'msg-sep' : undefined}>
                {line || '\u00A0'}
              </p>
            )
          })}
        </div>
      )}

      {msg.role === 'assistant' && sources.length > 0 && (
        <div className="cite-panel">
          <div className="cite-panel-title">引用 · {sources.length}</div>
          <ul className="citations">
            {sources.map((s) => {
              const open = openCite === s.n
              return (
                <li key={`${s.n}-${s.id || s.source}`} id={`cite-card-${msg.id}-${s.n}`}>
                  <div className={`cite-chip${open ? ' open' : ''}`}>
                    <button
                      type="button"
                      className="cite-chip-main"
                      onClick={() => setOpenCite(open ? null : s.n)}
                      title={s.source}
                    >
                      <span className="cite-num">[{s.n}]</span>
                      <span className="cite-label">
                        {s.brand}
                        {s.title ? ` · ${s.title}` : ''}
                      </span>
                    </button>
                    {onAskAboutSource && (
                      <button
                        type="button"
                        className="cite-ask"
                        title="围绕此条引用追问"
                        onClick={() => onAskAboutSource(s)}
                      >
                        追问
                      </button>
                    )}
                  </div>
                  {open && (
                    <div className="cite-detail">
                      <div className="cite-path">{s.brand} / {s.source}</div>
                      {s.snippet ? <p>{s.snippet}</p> : <p className="cite-empty">无摘要</p>}
                      {onAskAboutSource && (
                        <button
                          type="button"
                          className="cite-ask-wide"
                          onClick={() => onAskAboutSource(s)}
                        >
                          基于此条追问
                        </button>
                      )}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {msg.role === 'assistant' && (
        <div className="msg-actions">
          {ncSnippet ? (
            <button
              type="button"
              className={`msg-copy-btn msg-gcode-btn${gcodeSaved ? ' copied' : ''}`}
              onClick={() => void saveGcodeFile()}
              title="写入桌面「SAMA文件」和工程沙箱的加工程序目录"
              disabled={gcodeBusy || !onSaveGcodeFile}
            >
              {gcodeBusy ? '正在生成…' : gcodeSaved ? '已生成文件' : '生成 G 代码文件'}
            </button>
          ) : null}
          <button
            type="button"
            className={`msg-copy-btn${copied ? ' copied' : ''}`}
            onClick={() => void copyAnswer()}
            title="复制本条回答"
            disabled={!canCopy}
          >
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
      {ctxMenu && (
        <div
          className="msg-ctx-menu"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {ctxMenu.selection.trim() ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => void copyAnswer(ctxMenu.selection)}
            >
              复制选中
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={!canCopy}
            onClick={() => void copyAnswer()}
          >
            {msg.role === 'user' ? '复制本条消息' : '复制本条回答'}
          </button>
        </div>
      )}
    </div>
  )
})

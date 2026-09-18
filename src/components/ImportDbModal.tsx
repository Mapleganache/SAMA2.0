import { useState, type DragEvent } from 'react'
import { samaClient } from '../samaClient'
import type { KbStatus } from '../vite-env'

type Props = {
  onClose: () => void
  onImported: (kb: KbStatus | null, note: string) => void
}

export function ImportDbModal({ onClose, onImported }: Props) {
  const [dragging, setDragging] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [lastFiles, setLastFiles] = useState<string[]>([])

  async function importPaths(paths: string[]) {
    const clean = paths.filter(Boolean)
    if (!clean.length) {
      setMsg('未拿到本机路径。请用下方「选择文件/文件夹」，或从资源管理器拖入。')
      return
    }
    setBusy(true)
    setMsg('正在写入知识库并重建索引…')
    setLastFiles(clean.map((p) => p.split(/[/\\]/).pop() || p))
    try {
      const res = await samaClient.importPathsAsDatabase({ paths: clean })
      if (!res.ok) {
        setMsg(res.error || '入库失败')
        return
      }
      const kb = res.kb || (await samaClient.getKbStatus())
      const note = res.note || '资料已加入知识库'
      setMsg(note)
      onImported(kb, note)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function onDrop(e: DragEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDragging(false)
    const files = Array.from(e.dataTransfer.files || [])
    const paths = files.map((f) => samaClient.getPathForFile(f)).filter(Boolean)
    await importPaths(paths)
  }

  async function pickFiles() {
    setBusy(true)
    setMsg('')
    try {
      // 走系统对话框入库（与设置页同一能力）
      const res = await samaClient.importAsDatabase()
      if (res.canceled) {
        setMsg('已取消')
        return
      }
      if (!res.ok) {
        setMsg(res.error || '入库失败')
        return
      }
      const kb = res.kb || (await samaClient.getKbStatus())
      setMsg(res.note || '资料已加入知识库')
      onImported(kb, res.note || '资料已加入知识库')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal import-db-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-db-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="import-db-title">拖入资料 → 加入知识库</h2>
          </div>
          <button type="button" className="ghost-btn" onClick={onClose} disabled={busy}>
            关闭
          </button>
        </header>

        <div className="settings-body">
          <div
            className={`import-dropzone${dragging ? ' is-dragging' : ''}${busy ? ' is-busy' : ''}`}
            onDragEnter={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragging(true)
            }}
            onDragLeave={(e) => {
              e.preventDefault()
              if (e.currentTarget === e.target) setDragging(false)
            }}
            onDrop={(e) => void onDrop(e)}
          >
            <div className="import-dropzone-title">把文件或文件夹拖到这里</div>
            <div className="settings-actions" style={{ justifyContent: 'center' }}>
              <button type="button" className="send-btn" disabled={busy} onClick={() => void pickFiles()}>
                {busy ? '处理中…' : '选择文件或文件夹'}
              </button>
            </div>
          </div>

          {lastFiles.length > 0 && (
            <p className="mode-hint">最近拖入：{lastFiles.slice(0, 6).join('、')}</p>
          )}
          {msg && <p className="settings-msg">{msg}</p>}
        </div>
      </div>
    </div>
  )
}

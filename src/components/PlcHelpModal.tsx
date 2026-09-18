import { useEffect, useState } from 'react'
import { samaClient } from '../samaClient'

type Props = {
  onClose: () => void
  onBound?: () => void
}

export function PlcHelpModal({ onClose, onBound }: Props) {
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [found, setFound] = useState(false)
  const [fladderPath, setFladderPath] = useState('')
  const [hint, setHint] = useState('')

  async function refreshProbe() {
    const p = await samaClient.ladderProbe()
    setFound(Boolean(p.found))
    setFladderPath(p.fladderPath || '')
    setHint(p.hint || '')
  }

  useEffect(() => {
    void refreshProbe()
  }, [])

  async function scan() {
    setBusy('scan')
    setMsg('正在扫描 LADDER-III…')
    try {
      const r = await samaClient.industrialScanSoftware({ adapterId: 'plc.null' })
      await refreshProbe()
      onBound?.()
      setMsg(r.ok && r.path ? `已找到：${r.path}` : r.error || '常见位置没扫到，请添加安装目录')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  async function pickDir() {
    setBusy('pick')
    setMsg('请选择 FANUC LADDER-III 安装目录…')
    try {
      const r = await samaClient.industrialPickSoftwareDir({ adapterId: 'plc.null' })
      if (r.cancelled) {
        setMsg('')
        return
      }
      await refreshProbe()
      onBound?.()
      setMsg(r.ok && r.path ? `已绑定：${r.path}` : r.error || '这个目录里没找到 fladder.exe')
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  async function openLad() {
    setBusy('open')
    setMsg('请选择 .LAD 文件…')
    try {
      const picked = await samaClient.openLocalFiles()
      if (picked.canceled) {
        setMsg('')
        return
      }
      const lad = (picked.files || []).find((f) => /\.lad$/i.test(f.path || f.name || ''))
      if (!lad?.path) {
        setMsg('请选一个 .LAD 文件')
        return
      }
      const r = await samaClient.ladderOpen({
        ladPath: lad.path,
        approved: true,
        rememberSession: true,
      })
      if (!r.ok) {
        setMsg(r.error || '打开失败')
        return
      }
      setMsg(`已在 LADDER-III 打开：${lad.path}`)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plc-help-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="plc-help-title">Ladder 助手</h2>
          </div>
          <button type="button" className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="settings-body">
          <div className="block-label">1. 接上 LADDER-III</div>
          <p className="kb-status">
            {found ? '已找到软件' : '还没找到'}
            {fladderPath ? ` · ${fladderPath}` : ''}
          </p>
          {hint && !found ? <p className="mode-hint">{hint}</p> : null}
          <div className="settings-actions">
            <button type="button" className="ghost-btn" disabled={Boolean(busy)} onClick={() => void scan()}>
              {busy === 'scan' ? '扫描中…' : '扫描软件'}
            </button>
            <button type="button" className="ghost-btn" disabled={Boolean(busy)} onClick={() => void pickDir()}>
              {busy === 'pick' ? '选择中…' : '添加安装目录'}
            </button>
          </div>

          <div className="block-label" style={{ marginTop: 16 }}>
            2. 打开现有梯子
          </div>
          <p className="mode-hint">选本机 .LAD，用 FANUC LADDER-III 打开。改梯请把文件拖到对话里，再点允许。</p>
          <div className="settings-actions">
            <button
              type="button"
              className="send-btn"
              disabled={Boolean(busy) || !found}
              onClick={() => void openLad()}
            >
              {busy === 'open' ? '打开中…' : '选择并打开 .LAD'}
            </button>
          </div>

          <div className="block-label" style={{ marginTop: 16 }}>
            3. 改真正的梯子
          </div>
          <p className="mode-hint">把 .LAD 拖进本页对话，说明要改什么，再点允许。本页不写 PICTURE 画面，也不生成夹紧仿真样例。</p>

          {msg ? <p className="settings-msg">{msg}</p> : null}
        </div>
      </div>
    </div>
  )
}

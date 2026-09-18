import { useEffect, useState } from 'react'
import { samaClient } from '../samaClient'
import type { KbStatus, SamaSettings } from '../vite-env'

type Props = {
  onClose: () => void
  onSaved: (settings: SamaSettings, kb: KbStatus) => void
}

const PROVIDERS = [
  {
    id: 'groq',
    label: 'Groq（免费·推荐）',
    keyHint: 'console.groq.com 免费申请，一般不用绑卡',
  },
  {
    id: 'gemini',
    label: 'Gemini（免费额度）',
    keyHint: 'aistudio.google.com/apikey 免费申请',
  },
  {
    id: 'grok',
    label: 'Grok（xAI）',
    keyHint: '在 console.x.ai 创建 API Key',
  },
  {
    id: 'qwen',
    label: '通义千问（DashScope）',
    keyHint: '在 dashscope.console.aliyun.com 创建',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyHint: '在 platform.openai.com/api-keys 创建',
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    keyHint: '在 platform.deepseek.com 创建',
  },
] as const

const MODEL_OPTIONS: Record<string, { id: string; label: string }[]> = {
  groq: [
    { id: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B（推荐·文本·附图改用 Scout）' },
    { id: 'meta-llama/llama-4-scout-17b-16e-instruct', label: 'Llama 4 Scout（识图）' },
    { id: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B（更快）' },
    { id: 'gemma2-9b-it', label: 'Gemma2 9B' },
  ],
  gemini: [
    { id: 'gemini-2.0-flash', label: 'gemini-2.0-flash（推荐·识图）' },
    { id: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
    { id: 'gemini-2.0-flash-lite', label: 'gemini-2.0-flash-lite' },
    { id: 'gemini-1.5-flash', label: 'gemini-1.5-flash' },
  ],
  grok: [
    { id: 'grok-4-1-fast-non-reasoning', label: 'grok-4.1-fast（推荐·快）' },
    { id: 'grok-4', label: 'grok-4' },
    { id: 'grok-3-mini', label: 'grok-3-mini' },
    { id: 'grok-3', label: 'grok-3' },
  ],
  qwen: [
    { id: 'qwen3.8-max', label: 'qwen3.8-max（旗舰·识图）' },
    { id: 'qwen-vl-max', label: 'qwen-vl-max（识图）' },
    { id: 'qwen-vl-plus', label: 'qwen-vl-plus（识图）' },
    { id: 'qwen-plus', label: 'qwen-plus（文本·附图改用 VL）' },
    { id: 'qwen-turbo', label: 'qwen-turbo（文本·附图改用 VL）' },
    { id: 'qwen-max', label: 'qwen-max（文本·附图改用 VL）' },
  ],
  openai: [
    { id: 'gpt-4o', label: 'gpt-4o（识图推荐）' },
    { id: 'gpt-4o-mini', label: 'gpt-4o-mini（识图·便宜）' },
  ],
  deepseek: [
    { id: 'deepseek-chat', label: 'deepseek-chat（不能看图）' },
    { id: 'deepseek-reasoner', label: 'deepseek-reasoner（不能看图）' },
  ],
}

function defaultModelFor(provider: string) {
  return MODEL_OPTIONS[provider]?.[0]?.id || 'llama-3.3-70b-versatile'
}

function modelSeesImages(provider: string, model: string) {
  const p = provider.toLowerCase()
  if (p === 'gemini' || p === 'grok') return true
  if (p === 'openai') return /gpt-4o|gpt-5|vision|omni/i.test(model)
  if (p === 'qwen') return /vl|3\.8-max/i.test(model)
  if (p === 'groq') return /llama-4|scout|vision|llava/i.test(model)
  return false
}

function visionFallback(provider: string) {
  if (provider === 'qwen') return 'qwen-vl-max'
  if (provider === 'groq') return 'Llama 4 Scout'
  if (provider === 'openai') return 'gpt-4o'
  return ''
}

function providerMeta(id: string) {
  return PROVIDERS.find((p) => p.id === id) || PROVIDERS[0]
}

export function SettingsModal({ onClose, onSaved }: Props) {
  const [settings, setSettings] = useState<SamaSettings | null>(null)
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [provider, setProvider] = useState('groq')
  const [model, setModel] = useState(defaultModelFor('groq'))
  const [visionProvider, setVisionProvider] = useState('')
  const [visionModel, setVisionModel] = useState(defaultModelFor('qwen'))
  const [visionApiKeyInput, setVisionApiKeyInput] = useState('')
  const [fladderPath, setFladderPath] = useState('')
  const [kb, setKb] = useState<KbStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [includeMtkbInExport, setIncludeMtkbInExport] = useState(false)
  const [userDbCount, setUserDbCount] = useState(0)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [s, k] = await Promise.all([samaClient.getSettings(), samaClient.getKbStatus()])
      if (!alive) return
      setSettings(s)
      const p = s.provider || 'groq'
      setProvider(p)
      setModel(s.model || defaultModelFor(p))
      setVisionProvider(s.visionProvider || '')
      setVisionModel(s.visionModel || defaultModelFor(s.visionProvider || 'qwen'))
      setFladderPath(s.fladderPath || '')
      setKb(k)
      setApiKeyInput('')
      setVisionApiKeyInput('')
      const dbs = await samaClient.listUserDatabases()
      if (alive) setUserDbCount(dbs.databases?.filter((d) => d.exists).length || 0)
    })()
    return () => {
      alive = false
    }
  }, [])

  function onProviderChange(next: string) {
    setProvider(next)
    setModel(defaultModelFor(next))
  }

  function onVisionProviderChange(next: string) {
    setVisionProvider(next)
    setVisionModel(next ? defaultVisionModel(next) : '')
    setVisionApiKeyInput('')
  }

  function defaultVisionModel(p: string) {
    if (p === 'qwen') return 'qwen-vl-max'
    return defaultModelFor(p)
  }

  async function handleSave() {
    setBusy(true)
    setMsg('')
    try {
      const partial: {
        provider: string
        model: string
        apiKey?: string
        visionProvider: string
        visionModel: string
        visionApiKey?: string
        fladderPath?: string
      } = {
        provider,
        model,
        visionProvider,
        visionModel: visionProvider ? visionModel : '',
        fladderPath: fladderPath.trim(),
      }
      if (apiKeyInput.trim()) partial.apiKey = apiKeyInput.trim()
      if (visionProvider && visionApiKeyInput.trim()) {
        partial.visionApiKey = visionApiKeyInput.trim()
      }
      const saved = await samaClient.saveSettings(partial)
      if ((saved as { ok?: boolean }).ok === false) {
        setMsg((saved as { error?: string }).error || '保存失败')
        return
      }
      setSettings(saved)
      setApiKeyInput('')
      setVisionApiKeyInput('')
      setMsg('已保存')
      onSaved(saved, kb || (await samaClient.getKbStatus()))
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleTest() {
    setBusy(true)
    setMsg('')
    try {
      const partial: {
        provider: string
        model: string
        apiKey?: string
      } = { provider, model }
      if (apiKeyInput.trim()) partial.apiKey = apiKeyInput.trim()
      await samaClient.saveSettings(partial)
      setApiKeyInput('')
      const r = await samaClient.testApi()
      setMsg(r.ok ? `连通成功 · ${r.model || ''} · ${r.reply || ''}` : `失败：${r.error}`)
      setSettings(await samaClient.getSettings())
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleRebuild() {
    setBusy(true)
    setMsg('')
    try {
      const status = await samaClient.rebuildKb()
      if ((status as { ok?: boolean; error?: string }).ok === false) {
        setMsg((status as { error?: string }).error || '构建失败')
        return
      }
      setKb(status)
      setMsg(status.note || '知识库已更新')
      if (settings) onSaved(settings, status)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleImportAsDatabase() {
    setBusy(true)
    setMsg('')
    try {
      const res = await samaClient.importAsDatabase()
      if (res.canceled) {
        setMsg('已取消导入')
        return
      }
      if (!res.ok) {
        setMsg(res.error || '导入失败')
        return
      }
      if (res.kb) setKb(res.kb)
      const dbs = await samaClient.listUserDatabases()
      setUserDbCount(dbs.databases?.filter((d) => d.exists).length || 0)
      setMsg(res.note || '资料已入库')
      if (settings && res.kb) onSaved(settings, res.kb)
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleExportSharePackage() {
    setBusy(true)
    setMsg('')
    try {
      const res = await samaClient.exportSharePackage({
        includeBundledMtkb: includeMtkbInExport,
        includeUserDocs: true,
        includeUserDb: true,
      })
      if (res.canceled) {
        setMsg('已取消导出')
        return
      }
      if (!res.ok) {
        setMsg(res.error || '导出失败')
        return
      }
      setMsg(
        includeMtkbInExport
          ? `${res.note || '已导出'}（含完整 MTKB，体积较大）`
          : res.note || '已导出分享包',
      )
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const meta = providerMeta(provider)

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="settings-title">模型与知识库</h2>
          </div>
          <button type="button" className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="settings-body">
          <label className="field">
            <span>回答服务商</span>
            <select value={provider} onChange={(e) => onProviderChange(e.target.value)}>
              {PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>{meta.label} API Key（回答）</span>
            <input
              type="password"
              placeholder={
                settings?.hasProviderKey?.[provider] || (settings?.provider === provider && settings?.hasApiKey)
                  ? `已保存 ${settings.apiKey || ''}，留空则不修改`
                  : `${meta.keyHint}`
              }
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
              autoComplete="off"
            />
          </label>

          {(provider === 'groq' || provider === 'gemini') && (
            <p className="mode-hint">
              {provider === 'groq'
                ? 'Groq 有免费额度、速度快，适合日常问答。打开 console.groq.com → API Keys → Create API Key。'
                : 'Gemini 免费额度较大。打开 aistudio.google.com/apikey → 创建密钥。'}
            </p>
          )}

          <label className="field">
            <span>模型</span>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {(MODEL_OPTIONS[provider] || []).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </label>
          {(() => {
            const sees = modelSeesImages(provider, model)
            const fallback = visionFallback(provider)
            if (provider === 'deepseek' || (!sees && !fallback)) {
              return (
                <p className="mode-hint alert">
                  这个服务商看不了图。附图只会 OCR，问答仍用 {model}。
                </p>
              )
            }
            if (!sees && fallback) {
              return (
                <p className="mode-hint alert">
                  {model} 看不了图。附图将自动用 {fallback} 读图，写程序/聊天仍用 {model}。
                </p>
              )
            }
            return null
          })()}

          <label className="field">
            <span>识图服务商</span>
            <select
              value={visionProvider}
              onChange={(e) => onVisionProviderChange(e.target.value)}
            >
              <option value="">与回答相同</option>
              {PROVIDERS.filter((p) => p.id !== 'deepseek').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {visionProvider ? (
            <>
              <label className="field">
                <span>识图模型</span>
                <select value={visionModel} onChange={(e) => setVisionModel(e.target.value)}>
                  {(MODEL_OPTIONS[visionProvider] || []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>
              {visionProvider !== provider && (
                <label className="field">
                  <span>{providerMeta(visionProvider).label} API Key（识图）</span>
                  <input
                    type="password"
                    placeholder={
                      settings?.hasProviderKey?.[visionProvider]
                        ? `已保存 ${settings.visionApiKey || ''}，留空则不修改`
                        : providerMeta(visionProvider).keyHint
                    }
                    value={visionApiKeyInput}
                    onChange={(e) => setVisionApiKeyInput(e.target.value)}
                    autoComplete="off"
                  />
                </label>
              )}
            </>
          ) : null}

          <label className="field">
            <span>FANUC LADDER-III（可选）</span>
            <input
              type="text"
              placeholder="fladder.exe 完整路径，或安装目录"
              value={fladderPath}
              onChange={(e) => setFladderPath(e.target.value)}
              autoComplete="off"
            />
          </label>

          <div className="settings-actions">
            <button type="button" className="ghost-btn" disabled={busy} onClick={handleTest}>
              测试连通
            </button>
            <button type="button" className="send-btn" disabled={busy} onClick={handleSave}>
              保存
            </button>
          </div>

          <div className="kb-panel">
            <div className="block-label">本地知识库</div>
            <p className="kb-status">
              {kb?.ready ? '已就绪' : '未就绪'} · 文档 {kb?.docCount ?? 0} · 切片{' '}
              {kb?.chunkCount ?? 0}
              {kb?.updatedAt ? ` · 更新于 ${kb.updatedAt.replace('T', ' ').slice(0, 19)}` : ''}
            </p>
            {kb?.mtkb?.available && (
              <p className="mode-hint">
                MTKB {kb.mtkb.bundleVersion || '—'}
                {kb.mtkb.installed ? ' · 文档已接入' : ' · 文档待安装'}
                {kb.mtkb.sqliteReady ? ' · SQLite 已就绪' : ' · SQLite 未找到'}
                {kb.mtkb.documents ? ` · ${kb.mtkb.documents} 份资料` : ''}
                {userDbCount || kb.mtkb.userDatabaseCount
                  ? ` · 用户库 ${userDbCount || kb.mtkb.userDatabaseCount} 个`
                  : ''}
              </p>
            )}
            {kb?.note ? <p className="mode-hint">{kb.note}</p> : null}
            <div className="settings-actions">
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => void samaClient.openKbDocs()}
              >
                打开资料目录
              </button>
              <button type="button" className="ghost-btn" disabled={busy} onClick={handleRebuild}>
                构建/更新知识库
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => samaClient.openDataDir()}
              >
                打开存档目录
              </button>
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className="send-btn"
                disabled={busy}
                onClick={() => void handleImportAsDatabase()}
              >
                导入资料入库
              </button>
              <button
                type="button"
                className="ghost-btn"
                disabled={busy}
                onClick={() => void handleExportSharePackage()}
              >
                导出分享包
              </button>
            </div>
            <label className="field" style={{ marginTop: 4 }}>
              <span className="mode-hint" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="checkbox"
                  checked={includeMtkbInExport}
                  disabled={busy}
                  onChange={(e) => setIncludeMtkbInExport(e.target.checked)}
                />
                导出时附带完整内置 MTKB（约数百 MB，对方无需自备库）
              </span>
            </label>
          </div>

          {msg && <p className="settings-msg">{msg}</p>}
        </div>
      </div>
    </div>
  )
}

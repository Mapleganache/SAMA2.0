import type { AllowActionKind, ProposedLadEdit } from '../ladAllow'
import type { DesktopToolCall } from '../desktopAllow'

export type AllowRequest = {
  id: string
  kind: AllowActionKind | 'desktop'
  title: string
  detail: string
  ladPath: string
  fladderPath?: string
  proposed?: ProposedLadEdit
  sourceMsgId?: string
  step?: number
  total?: number
  /** Desktop 专用 */
  desktop?: DesktopToolCall
}

export type AllowChoice = 'once' | 'always'

type Props = {
  request: AllowRequest
  busy?: boolean
  collapsed?: boolean
  onCollapse: () => void
  onExpand: () => void
  onAllow: (choice: AllowChoice) => void
  onDeny: () => void
  /** 删除/关掉这张权限卡（与拒绝相同销账） */
  onDismiss?: () => void
}

/** Cursor 风格：一次一项；「允许」/「以后都允许」/「拒绝」；可删除关掉 */
export function AllowActionCard({
  request,
  busy,
  collapsed,
  onCollapse,
  onExpand,
  onAllow,
  onDeny,
  onDismiss,
}: Props) {
  const dismiss = onDismiss || onDeny
  const stepLabel =
    request.step && request.total && request.total > 1
      ? `${request.step}/${request.total}`
      : null
  const shortLad = request.ladPath.split(/[/\\]/).pop() || request.ladPath
  const pathLabel =
    request.kind === 'desktop'
      ? request.desktop?.tool || 'desktop'
      : shortLad

  if (collapsed) {
    return (
      <div className="allow-card allow-card-collapsed" role="status">
        <div className="allow-card-collapsed-main">
          <span className="allow-card-badge">待允许</span>
          {stepLabel ? <span className="allow-card-step">{stepLabel}</span> : null}
          <span className="allow-card-collapsed-title" title={request.title}>
            {request.title}
          </span>
        </div>
        <div className="allow-card-actions">
          <button
            type="button"
            className="allow-card-del"
            disabled={busy}
            title="删除此权限卡"
            onClick={dismiss}
          >
            删除
          </button>
          <button type="button" className="send-btn" disabled={busy} onClick={onExpand}>
            展开
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="allow-card" role="alertdialog" aria-labelledby={`allow-title-${request.id}`}>
      <div className="allow-card-head">
        <span className="allow-card-badge">需要允许</span>
        {stepLabel ? <span className="allow-card-step">{stepLabel}</span> : null}
        <h3 id={`allow-title-${request.id}`}>{request.title}</h3>
        <button
          type="button"
          className="allow-card-min"
          disabled={busy}
          title="收起"
          onClick={onCollapse}
        >
          −
        </button>
        <button
          type="button"
          className="allow-card-del"
          disabled={busy}
          title="删除此权限卡"
          onClick={dismiss}
        >
          ×
        </button>
      </div>
      <p className="allow-card-path" title={request.kind === 'desktop' ? request.detail : request.ladPath}>
        {pathLabel}
      </p>
      {request.detail ? <p className="allow-card-detail">{request.detail}</p> : null}
      {request.kind === 'desktop' && request.desktop ? (
        <p className="msg-allow-propose">
          {request.desktop.tool}
          {request.desktop.approvalId ? ` · ${request.desktop.approvalId}` : ''}
        </p>
      ) : null}
      {request.proposed?.name || request.proposed?.input ? (
        <p className="msg-allow-propose">
          {request.proposed.name || '（未命名）'}
          {request.proposed.input ? ` ← ${request.proposed.input}` : ''}
          {request.proposed.output ? ` → ${request.proposed.output}` : ''}
        </p>
      ) : null}
      <div className="allow-card-actions allow-card-actions-main">
        <button type="button" className="ghost-btn" disabled={busy} onClick={onDeny}>
          拒绝
        </button>
        <button
          type="button"
          className="allow-card-del allow-card-del-text"
          disabled={busy}
          title="删除此权限卡，不再申请"
          onClick={dismiss}
        >
          删除
        </button>
        <button
          type="button"
          className="ghost-btn"
          disabled={busy}
          onClick={() => onAllow('once')}
        >
          允许
        </button>
        <button
          type="button"
          className="send-btn"
          disabled={busy}
          title="本会话内打开/导出不再询问；写入与生成演示仍会确认"
          onClick={() => onAllow('always')}
        >
          以后都允许
        </button>
      </div>
    </div>
  )
}

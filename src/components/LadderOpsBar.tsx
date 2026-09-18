import { useState } from 'react'

type Props = {
  ladPath: string
  allowed: boolean
  busy?: boolean
  /** 默认收起，避免一直占输入区 */
  defaultExpanded?: boolean
  onRequestAllow: () => void
  onOpenGui: () => void
  onExportAnalyze: () => void
  onExportOnly: () => void
  onEditProposal?: () => void
  /** 基于当前/模板工程生成演示复杂梯形 */
  onGenerateDemo?: () => void
  /** 清除/关掉这条 LAD 操作条 */
  onDismiss?: () => void
}

/** 默认收起成一行；点开才显示打开/导出/写入 */
export function LadderOpsBar({
  ladPath,
  allowed,
  busy,
  defaultExpanded = false,
  onRequestAllow,
  onOpenGui,
  onExportAnalyze,
  onExportOnly,
  onEditProposal,
  onGenerateDemo,
  onDismiss,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const short = ladPath.split(/[/\\]/).pop() || ladPath

  return (
    <div className="ladder-ops-bar ladder-ops-bar-compact" aria-label="LADDER-III 简易操作">
      <div className="ladder-ops-row">
        <button
          type="button"
          className="ladder-ops-chip"
          disabled={busy}
          title={expanded ? '收起' : '展开操作'}
          onClick={() => setExpanded((v) => !v)}
        >
          <strong>LAD</strong>
          <span className="ladder-ops-file" title={ladPath}>
            {short}
          </span>
          <span className={`ladder-ops-state ${allowed ? 'on' : ''}`}>
            {allowed ? '已允许' : '未允许'}
          </span>
          <span className="ladder-ops-caret">{expanded ? '▴' : '▾'}</span>
        </button>
        {onDismiss ? (
          <button
            type="button"
            className="ladder-ops-dismiss"
            disabled={busy}
            title="清除这条 LAD（不再显示操作条）"
            onClick={onDismiss}
          >
            ×
          </button>
        ) : null}
      </div>
      {expanded ? (
        <div className="ladder-ops-actions">
          {!allowed ? (
            <button type="button" className="send-btn" disabled={busy} onClick={onRequestAllow}>
              允许并操作
            </button>
          ) : (
            <>
              <button type="button" className="ghost-btn" disabled={busy} onClick={onOpenGui}>
                打开
              </button>
              <button type="button" className="ghost-btn" disabled={busy} onClick={onExportOnly}>
                导出
              </button>
              <button type="button" className="ghost-btn" disabled={busy} onClick={onExportAnalyze}>
                报告
              </button>
              {onEditProposal ? (
                <button type="button" className="send-btn" disabled={busy} onClick={onEditProposal}>
                  写入
                </button>
              ) : null}
              {onGenerateDemo ? (
                <button
                  type="button"
                  className="ghost-btn"
                  disabled={busy}
                  title="基于当前工程外壳生成演示 LAD（另存桌面，不覆盖模板）"
                  onClick={onGenerateDemo}
                >
                  生成演示
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

import type { Library } from '../data'

type Props = {
  libraries: Library[]
  onToggle: (id: string) => void
  onClose: () => void
}

export function LibraryPicker({ libraries, onToggle, onClose }: Props) {
  const enabledCount = libraries.filter((l) => l.enabled).length

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="lib-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="lib-title">选择接入的资料库</h2>
          </div>
          <button type="button" className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </header>

        <ul className="lib-list">
          {libraries.map((lib) => (
            <li key={lib.id}>
              <label className={lib.enabled ? 'lib-card on' : 'lib-card'}>
                <input
                  type="checkbox"
                  checked={lib.enabled}
                  onChange={() => onToggle(lib.id)}
                />
                <div>
                  <div className="lib-card-top">
                    <span className="lib-brand">{lib.brand}</span>
                    <span className="lib-ver">{lib.version}</span>
                  </div>
                  <strong>{lib.title}</strong>
                  <small>
                    {lib.docs > 0 ? `约 ${lib.docs} 份资料/切片` : '随导入自动增长'}
                  </small>
                </div>
              </label>
            </li>
          ))}
        </ul>

        <footer className="modal-footer">
          <span>已接入 {enabledCount} 个库</span>
          <button type="button" className="send-btn" onClick={onClose}>
            完成
          </button>
        </footer>
      </div>
    </div>
  )
}

import { useMemo, useState } from 'react'

type Faq = {
  id: string
  q: string
  keys: string[]
  a: string
}

const FAQ: Faq[] = [
  {
    id: 'soft',
    q: 'LADDER-III 装在哪？',
    keys: ['装', '软件', 'fladder', '路径', '找不到', '安装', 'ladder-iii', '梯子软件'],
    a: '这台电脑上软件在 D:\\机床软件\\Fladder.exe，不在 C:\\Program Files。开始菜单也能搜到 FANUC LADDER-III。Ladder 助手里「添加安装目录」请选整个「机床软件」文件夹，不要去找名叫 FANUC LADDER-III 的子目录。',
  },
  {
    id: 'lad',
    q: '.LAD 和软件有什么区别？',
    keys: ['lad', '工程', '文件', '区别', '什么是'],
    a: 'Fladder.exe 是编程软件。.LAD 才是梯形图工程文件。改梯要打开的是 .LAD，不是安装目录里那个空的 Lad 文件夹。你的工程多半在桌面，例如 studer.LAD、mikrosa(1).LAD。',
  },
  {
    id: 'open',
    q: '怎么打开我自己的梯子？',
    keys: ['打开', '选择', '怎么选', '对话框', '阅读本机'],
    a: '在 Ladder 页点助手 →「选择并打开 .LAD」。弹出的窗口是选文件，不是选软件。左边点「桌面」，选 .LAD 再打开。不要选 D:\\机床软件。改梯：把 .LAD 拖进 Ladder 页对话，再点允许。',
  },
  {
    id: 'split',
    q: 'Ladder 和 PICTURE 有什么区别？',
    keys: ['picture', 'fp', 'fp2', '画面', '混', '区别'],
    a: 'PLC 下面有两个选项：Ladder 只改 .LAD 梯形；PICTURE 只改 .fp2 / 画面 XML。两边不要混用：梯子里不要写画面，画面里不要写梯形。'
  },
  {
    id: 'edit',
    q: '怎么改真正的梯形图？',
    keys: ['改梯', '写入', '允许', '助记符', 'mnemonictosrc'],
    a: '1. 完全关掉 LADDER-III（不要只最小化）。2. 把桌面上的 .LAD 拖进 Ladder 页。3. 说明要改什么。4. 出现「允许」再点。微信目录里的文件请先拷到桌面。SAMA 不会自动往机床下载。画面工程请到 PICTURE 页写 .fp2 / XML。',
  },
  {
    id: 'io',
    q: 'X / Y / M 是什么？',
    keys: ['x0', 'y0', 'm0', '地址', 'io', '输入', '输出'],
    a: 'X 是输入（按钮、到位开关），Y 是输出（阀、接触器），M 是内部继电器。地址必须落在本机 PMC 合法范围，不要用机床上不存在的 X1000 之类。',
  },
]

function matchFaq(text: string): Faq | null {
  const q = text.trim().toLowerCase()
  if (!q) return null
  let best: Faq | null = null
  let score = 0
  for (const item of FAQ) {
    let n = 0
    if (item.q.toLowerCase().includes(q) || q.includes(item.q.toLowerCase())) n += 3
    for (const k of item.keys) {
      if (q.includes(k.toLowerCase()) || k.toLowerCase().includes(q)) n += 1
    }
    if (n > score) {
      score = n
      best = item
    }
  }
  return score > 0 ? best : null
}

type Props = {
  onClose: () => void
  onOpenHelper?: () => void
  topic?: string
  page?: 'lad' | 'fp'
}

export function PlcExplainModal({ onClose, onOpenHelper, topic, page = 'lad' }: Props) {
  const initial = FAQ.find((f) => f.id === topic) || FAQ[0]
  const [ask, setAsk] = useState('')
  const [activeId, setActiveId] = useState(initial.id)
  const [miss, setMiss] = useState('')

  const active = useMemo(() => FAQ.find((f) => f.id === activeId) || FAQ[0], [activeId])

  function explainTyped() {
    const hit = matchFaq(ask)
    if (hit) {
      setActiveId(hit.id)
      setMiss('')
      return
    }
    setMiss('这页没有对应条目。可点下面的常见问题，或去左侧「对话」里问。')
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal plc-explain-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="plc-explain-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="plc-explain-title">Ladder / PICTURE 说明</h2>
          </div>
          <button type="button" className="ghost-btn" onClick={onClose}>
            关闭
          </button>
        </header>

        <div className="settings-body">
          <div className="plc-explain-ask">
            <input
              type="text"
              value={ask}
              placeholder="例如：LAD 装在哪、Ladder 和 PICTURE 有什么区别"
              aria-label="输入要解释的问题"
              onChange={(e) => setAsk(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') explainTyped()
              }}
            />
            <button type="button" className="primary-btn" onClick={explainTyped}>
              解释
            </button>
          </div>
          {miss ? <p className="mode-hint">{miss}</p> : null}

          <div className="plc-explain-qs" role="list">
            {FAQ.map((item) => (
              <button
                key={item.id}
                type="button"
                className={item.id === active.id ? 'on' : ''}
                onClick={() => {
                  setActiveId(item.id)
                  setMiss('')
                }}
              >
                {item.q}
              </button>
            ))}
          </div>

          <p className="plc-explain-a">{active.a}</p>

          <div className="settings-actions">
            {page === 'lad' ? (
              <button
                type="button"
                className="ghost-btn"
                onClick={() => {
                  onOpenHelper?.()
                  onClose()
                }}
              >
                打开 Ladder 助手
              </button>
            ) : (
              <p className="mode-hint">本页只写 .fp2 / 画面 XML。要改梯形请切到 Ladder 页。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export type Library = {
  id: string
  brand: string
  title: string
  version: string
  docs: number
  enabled: boolean
}

export type ChatSession = {
  id: string
  title: string
  mode: 'ask' | 'agent'
  updatedAt: string
  /** 主对话与各工业页对话分开存，互不串历史 */
  kind?: 'chat' | 'mech' | 'elec' | 'plc' | 'fp' | 'lad' | 'cam'
}

export type Message = {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  citations?: string[]
  /** 本回合知识库命中（豆包式引用） */
  sources?: KbSource[]
  /** 本回合成功写入的文件，供双击在 SAMA 内打开 */
  fileOps?: {
    path: string
    bytes?: number
    created?: boolean
    external?: boolean
    ok?: boolean
  }[]
  /** 工业样例预览（对话内展示：机械/电气/PLC/加工） */
  plcSample?: {
    title?: string
    description?: string
    ioTable?: { addr?: string; name?: string; device?: string }[]
    sequenceOk?: boolean
    plc?: {
      ascii?: string
      mnemonic?: string
      rungs?: { id?: string; type?: string; comment?: string; ascii?: string }[]
      simulation?: {
        ok?: boolean
        total?: number
        passed?: number
        failed?: number
        results?: { id?: string; name?: string; ok?: boolean }[]
      }
    }
    electrical?: {
      svg?: string
      bom?: { id?: string; type?: string; qty?: number }[]
      connectivityText?: string
      markdown?: string
      path?: string
      txtPath?: string
      deviceCount?: number
      edgeCount?: number
    }
    cam?: { nc?: string }
    cad?: { geometry?: Record<string, unknown> }
  }
  /** 本回合写入前的文件快照，用于撤回恢复 */
  undoSnapshots?: {
    path: string
    existed: boolean
    previousContent: string | null
  }[]
}

export type KbSource = {
  n: number
  id?: string
  brand: string
  source: string
  title?: string
  snippet?: string
  score?: number
}

export type FileNode = {
  name: string
  type: 'folder' | 'file'
  children?: FileNode[]
}

export const defaultLibraries: Library[] = [
  {
    id: 'mtkb-common',
    brand: '通用',
    title: 'MTKB 机床智能体 · 共通库',
    version: 'mtkb-sama-1.0.0',
    docs: 734,
    enabled: true,
  },
  {
    id: 'mtkb-circuit',
    brand: '通用',
    title: 'MTKB 电路 / PMC / 联锁专有库',
    version: 'mtkb-sama-1.0.0',
    docs: 1345,
    enabled: true,
  },
  {
    id: 'mtkb-equipment',
    brand: '通用',
    title: 'MTKB 设备专有库',
    version: 'mtkb-sama-1.0.0',
    docs: 36,
    enabled: true,
  },
  {
    id: 'studer',
    brand: 'STUDER',
    title: 'STUDER 磨床 / 梯形审查资料',
    version: 'CASE-S40',
    docs: 20,
    enabled: true,
  },
  {
    id: 'mikrosa',
    brand: 'MIKROSA',
    title: 'MIKROSA 磨床 / PMC 审查资料',
    version: 'CASE-SASL',
    docs: 10,
    enabled: true,
  },
  {
    id: 'fanuc-31i',
    brand: 'FANUC',
    title: 'Series 31i-B / 0i 相关资料',
    version: 'B-64484CM',
    docs: 42,
    enabled: true,
  },
  {
    id: 'fanuc-picture',
    brand: 'FANUC',
    title: 'PICTURE / HMI 资料',
    version: 'B-66284CM',
    docs: 18,
    enabled: true,
  },
  {
    id: 'siemens-840d',
    brand: 'SIEMENS',
    title: 'SINUMERIK 840D sl 编程',
    version: '6FC5398',
    docs: 36,
    enabled: true,
  },
  {
    id: 'mitsubishi-m80',
    brand: 'MITSUBISHI',
    title: 'M80/M800 报警与参数',
    version: 'IB-1501275',
    docs: 24,
    enabled: false,
  },
  {
    id: 'heidenhain-tnc',
    brand: 'HEIDENHAIN',
    title: 'TNC 640 用户手册',
    version: '893988',
    docs: 15,
    enabled: false,
  },
  {
    id: 'user-import',
    brand: '用户库',
    title: '用户导入 / 分享包资料',
    version: 'local',
    docs: 0,
    enabled: true,
  },
]

export const defaultSessions: ChatSession[] = [
  {
    id: 's1',
    title: '台阶参数画面焦点索引',
    mode: 'agent',
    updatedAt: '今天 14:22',
  },
  {
    id: 's2',
    title: 'G76 螺纹循环参数说明',
    mode: 'ask',
    updatedAt: '今天 11:05',
  },
  {
    id: 's3',
    title: '报警 1016 排查步骤',
    mode: 'ask',
    updatedAt: '昨天 16:40',
  },
  {
    id: 's4',
    title: '宏变量 #500 读写模板',
    mode: 'agent',
    updatedAt: '昨天 09:18',
  },
]

export const welcomeMessages: Message[] = [
  {
    id: 'm0',
    role: 'system',
    content:
      '已接入知识库：FANUC 31i-B、FANUC PICTURE。资料整理完成后，回答将附带手册出处。',
  },
  {
    id: 'm1',
    role: 'assistant',
    content:
      '你好，我是 SAMA。可以帮你写 G 代码、排查报警，或生成机床前端（如 FANUC PICTURE）相关片段。\n\n请先在左上角确认已接入的资料库，然后用 Ask 提问，或用 Agent 让我按步骤改文件。',
    citations: ['FANUC PICTURE / B-66284CM · 总则'],
  },
]

export const projectTree: FileNode[] = [
  {
    name: 'projects',
    type: 'folder',
    children: [
      {
        name: 'studer-step',
        type: 'folder',
        children: [
          { name: 'step_param.xml', type: 'file' },
          { name: 'macro_common.nc', type: 'file' },
          { name: 'notes.md', type: 'file' },
        ],
      },
      {
        name: 'gcode-samples',
        type: 'folder',
        children: [
          { name: 'README.md', type: 'file' },
          { name: '01_mill_profile.nc', type: 'file' },
          { name: '02_mill_facing.nc', type: 'file' },
          { name: '03_mill_circle.nc', type: 'file' },
          { name: '04_mill_pocket.nc', type: 'file' },
          { name: '05_mill_drill_g81.nc', type: 'file' },
          { name: '06_mill_peck_g83.nc', type: 'file' },
          { name: '07_mill_contour_arc.nc', type: 'file' },
          { name: 'mill_contour.nc', type: 'file' },
          { name: 'lathe_face.nc', type: 'file' },
        ],
      },
    ],
  },
  {
    name: 'libraries',
    type: 'folder',
    children: [
      { name: 'FANUC_31i', type: 'folder', children: [{ name: 'README.md', type: 'file' }] },
      { name: 'FANUC_PICTURE', type: 'folder', children: [{ name: 'README.md', type: 'file' }] },
    ],
  },
]

export const sampleFileContents: Record<string, string> = {
  'step_param.xml': `<!-- FANUC PICTURE · 台阶参数示例 -->
<FPInput>
  <FocusIndex>1</FocusIndex>
  <Read>rdmacro(501, 99, 0)</Read>
  <Write>wrmacro(501, 0, 0, 99, 0)</Write>
  <WatchPMC>D2950</WatchPMC>
</FPInput>`,
  'macro_common.nc': `O9001 (COMMON MACRO)
#501 = 0
#502 = 0
M99`,
  'notes.md': `# Studer 台阶参数

- 焦点索引同屏不可重复
- 公共变量注意选项范围`,
  '01_mill_profile.nc': `%
O1101 (SAMA DEMO · 矩形轮廓铣)
G21 G90 G54 G17
T01 M06
S2000 M03
G00 X0 Y0 Z50
G01 Z-5 F200
G01 X100 F300
G01 Y50
G01 X0
G01 Y0
G00 Z50
M30
%`,
  '07_mill_contour_arc.nc': `%
O1107 (SAMA DEMO · 轮廓+圆弧)
G21 G90 G54 G17
T01 M06
S2000 M03
G00 X0 Y0 Z50
G01 Z-2 F100
G01 X40 F300
G01 Y30
G02 X60 Y50 I0 J20
G01 X20
G03 X0 Y0 I-10 J0
G00 Z50
M30
%`,
  'README.md': `# G-code 案例

左侧打开 .nc 后，点「刀路」可看轨迹。`,
}

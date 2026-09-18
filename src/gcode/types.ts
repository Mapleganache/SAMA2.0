export type MotionType = 'rapid' | 'feed' | 'arc_cw' | 'arc_ccw'

export type ProgramKind = 'mill' | 'lathe' | 'grind'

export type GCodePoint = {
  x: number
  y: number
  z: number
}

export type ToolpathSegment = {
  type: MotionType
  from: GCodePoint
  to: GCodePoint
  /** 折线点（直线为 2 点，圆弧为近似多点） */
  points: GCodePoint[]
  line: number
  feed?: number
}

export type GCodeIssueLevel = 'error' | 'warn' | 'info'

export type GCodeIssue = {
  level: GCodeIssueLevel
  line: number
  message: string
}

export type MachineLimits = {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  zMin: number
  zMax: number
  maxFeed: number
  maxSpindle: number
}

export type Bounds = {
  xMin: number
  xMax: number
  yMin: number
  yMax: number
  zMin: number
  zMax: number
}

export type GCodeParseResult = {
  segments: ToolpathSegment[]
  issues: GCodeIssue[]
  bounds: Bounds
  usedAxes: { x: boolean; y: boolean; z: boolean }
  stats: {
    lineCount: number
    moveCount: number
    rapidCount: number
    feedCount: number
    arcCount: number
    pathLength: number
  }
  modal: {
    units: 'mm' | 'inch'
    absolute: boolean
    plane: 'XY' | 'XZ' | 'YZ'
    /** 车/磨：X 为工件直径（φ40 写 X40） */
    diameter: boolean
    kind: ProgramKind
  }
}

export const DEFAULT_LIMITS: MachineLimits = {
  xMin: -800,
  xMax: 800,
  yMin: -600,
  yMax: 600,
  zMin: -2000,
  zMax: 2000,
  maxFeed: 5000,
  maxSpindle: 8000,
}

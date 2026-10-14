const FAMILIES = [
  {
    id: 'studer',
    label: 'STUDER 外圆磨',
    test: /studer|斯图特/i,
    note: '按该机主轴、砂轮架和工作台结构排查。不要把其他磨床的砂轮线速度、液压压力或间隙数值套过来。',
  },
  {
    id: 'gaoqiao',
    label: '高桥外圆/万能磨',
    test: /高桥/,
    note: '头架、砂轮架和内圆磨具是不同单元。发热或振动要先分清是砂轮主轴还是工件头架，再决定测点。',
  },
  {
    id: 'mikrosa',
    label: 'MIKROSA 无心磨',
    test: /mikrosa|米克罗莎/i,
    note: '无心磨优先看导轮、托板和砂轮，不要按外圆磨的头架尾架顶尖方式排查。',
  },
  {
    id: 'centerless',
    label: '无心磨',
    test: /无心/,
    note: '通磨直线度和表面振纹多与导轮倾角、托板磨损、砂轮平衡有关。',
  },
  {
    id: 'internal',
    label: '内圆磨',
    test: /内圆/,
    note: '内圆磨具转速高、轴系细。温升和振纹先查磨具润滑、皮带和砂轮接杆，不要直接拆主轴。',
  },
  {
    id: 'surface',
    label: '平面磨',
    test: /平面磨|鹰贝/,
    note: '平面磨先区分工作台换向冲击和磨头振动。液压换向异常不要当成砂轮不平衡。',
  },
  {
    id: 'cylindrical',
    label: '外圆磨',
    test: /外圆/,
    note: '外圆磨把工件回转、砂轮回转和工作台进给分开验证。空转正常而磨削才出现的现象，优先看砂轮、冷却和进给。',
  },
]

export function identifyMachine(query) {
  const text = String(query || '')
  const hit = FAMILIES.find((item) => item.test.test(text))
  if (!hit) {
    return {
      id: 'unknown',
      label: '未识别具体磨床',
      note: '用户没有给出可识别的机床家族。方案只给通用排查顺序，不要编造该机参数。',
    }
  }
  return { id: hit.id, label: hit.label, note: hit.note }
}

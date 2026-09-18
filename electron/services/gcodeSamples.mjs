/**
 * 内置 G-code 案例（写入用户 workspace/projects/gcode-samples）
 * 启动时由 ensureDemoGcode 同步，保证左侧树可直接打开并切「刀路」预览。
 */

export const GCODE_SAMPLE_FILES = {
  'projects/gcode-samples/README.md': `# G-code 案例（可直接在 SAMA 里打开）

本目录在左侧工程树：**projects → gcode-samples**

## 怎么看

1. 展开 \`projects\` → \`gcode-samples\`
2. 点任意 \`.nc\` 文件
3. 上方切换 **代码 / 刀路** 查看轨迹

推荐：\`08_grind_od_shaft.nc\`（磨床 XZ）或 \`01_mill_profile.nc\`（铣削 XY）
`,

  'projects/gcode-samples/01_mill_profile.nc': `%
O1101 (SAMA DEMO · 矩形轮廓铣)
(打开后点「刀路」可看 XY 轨迹)
G21 G90 G54 G17
G40 G49 G80 G98
T01 M06
S2000 M03
M08
G00 X0 Y0 Z50
G00 Z5
G01 Z-5 F200
G01 X100 F300
G01 Y50
G01 X0
G01 Y0
G00 Z50
M09
M05
G49
M30
%
`,

  'projects/gcode-samples/02_mill_facing.nc': `%
O1102 (SAMA DEMO · 端面铣削)
G21 G90 G54 G17
G40 G49 G80
T01 M06
S1800 M03
M08
G00 X-5 Y0 Z50
G00 Z2
G01 Z-1 F200
G01 X105 F400
G00 Y15
G01 X-5
G00 Y30
G01 X105
G00 Y45
G01 X-5
G00 Z50
M09
M05
M30
%
`,

  'projects/gcode-samples/03_mill_circle.nc': `%
O1103 (SAMA DEMO · 圆形轮廓 G02/G03)
G21 G90 G54 G17
G40 G49 G80
T01 M06
S2200 M03
M08
G00 X40 Y20 Z50
G00 Z5
G01 Z-3 F150
G02 X40 Y20 I0 J20 F280
G00 Z50
G00 X40 Y40
G00 Z5
G01 Z-3 F150
G03 X40 Y40 I0 J-10 F280
G00 Z50
M09
M05
M30
%
`,

  'projects/gcode-samples/04_mill_pocket.nc': `%
O1104 (SAMA DEMO · 矩形槽/口袋)
G21 G90 G54 G17
G40 G49 G80
T02 M06
S2500 M03
M08
G00 X20 Y15 Z50
G00 Z2
G01 Z-4 F120
G01 X60 F250
G01 Y35
G01 X20
G01 Y15
G01 Z-8 F100
G01 X60 F220
G01 Y35
G01 X20
G01 Y15
G00 Z50
M09
M05
M30
%
`,

  'projects/gcode-samples/05_mill_drill_g81.nc': `%
O1105 (SAMA DEMO · G81 钻孔循环)
G21 G90 G54 G17
G40 G49 G80 G98
T03 M06
S1500 M03
M08
G00 X0 Y0 Z50
G43 H03 Z50
G00 X20 Y20
G98 G81 Z-12 R2 F100
X40 Y20
X40 Y40
X20 Y40
G80
G00 Z50
M09
M05
G49
M30
%
`,

  'projects/gcode-samples/06_mill_peck_g83.nc': `%
O1106 (SAMA DEMO · G83 深孔啄钻)
G21 G90 G54 G17
G40 G49 G80 G98
T02 M06
S1800 M03
M08
G00 X0 Y0 Z50
G43 H02 Z50
G00 X30 Y25
G98 G83 X30 Y25 Z-28 R2 Q5 F120
G80
G00 Z50
M09
M05
G49
M30
%
`,

  'projects/gcode-samples/07_mill_contour_arc.nc': `%
O1107 (SAMA DEMO · 轮廓+圆弧组合)
G21 G90 G54 G17
G40 G49 G80
T01 M06
S2000 M03
M08
G00 X0 Y0 Z50
G00 Z5
G01 Z-2 F100
G01 X40 F300
G01 Y30
G02 X60 Y50 I0 J20
G01 X20
G01 Y10
G03 X0 Y0 I-10 J0
G00 Z50
G00 X0 Y0
M09
M05
M30
%
`,

  'projects/gcode-samples/mill_contour.nc': `%
O1001 (SAMA MILL CONTOUR DEMO)
G21 G17 G90 G94
G54
T1 M06
S2000 M03
G00 X0 Y0 Z50
G00 Z5
G01 Z-2 F100
G01 X40 F300
G01 Y30
G02 X60 Y50 I0 J20
G01 X20
G01 Y10
G03 X0 Y0 I-10 J0
G00 Z50
G00 X0 Y0
M05
M30
%
`,

  'projects/gcode-samples/lathe_face.nc': `%
O2001 (SAMA LATHE XZ DEMO)
G21 G18 G90
G00 X80 Z5
G00 X50
G01 Z0 F0.2
G01 X20 Z-5
G01 Z-25
G02 X30 Z-30 R5
G01 X45
G00 Z5
G00 X80
M30
%
`,

  'projects/gcode-samples/08_grind_od_shaft.nc': `%
O3301 (STUDER S33 · 光轴外圆纵磨示意)
(零件：φ40 × L120  毛坯 φ40.3)
(X=工件直径正值  Z0=左端  向右为负)
G21 G90 G94
G00 X50 Z5
G00 X40.3 Z0
G01 X40.3 Z-120 F0.3
G00 X50
G00 X40 Z0
G01 X40 Z-120 F0.08
G00 X50 Z5
M05
M30
%
`,
}

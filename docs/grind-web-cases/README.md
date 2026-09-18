# 网上能找到的磨床数据（型号 / 尺寸 / 图纸 / 程序）

结论先说：**STUDER、MIKROSA 原厂几乎不公开「零件图 + 完整加工程序」成套资料。**  
它们用 StuderWIN / Pictogramming / 840D 图形界面，网上最多只有机型规格、循环名称、教学视频。下面这包是按**公开机型规格 + 能查到的零件尺寸**整理的，程序是 **ISO G00/G01 示意**（X=工件直径正值），下机床前要按本机循环改写。

目录：`docs/grind-web-cases/`

## 公开机型（能核对的规格）

| 型号 | 类型 | 系统 | 公开能力 | 出处 |
|------|------|------|----------|------|
| **STUDER S33** | 万能外圆 | FANUC 0i-TD + StuderWIN | 顶尖距 400/650/1000/1600，中心高 175，最大工件约 φ349、150kg | [studer.com S33](https://www.studer.com/en/cylindrical-grinding-machines/grinding/product/s33/) |
| **STUDER S41** | 大型万能外圆 | C.O.R.E. / StuderWIN | 顶尖距 1000/1600，中心高 225/275，约 250kg | [studer.com S41](https://www.studer.com/en/cylindrical-grinding-machines/grinding/product/s41/) |
| **STUDER S31 / favoritCNC / S122** | 外圆 / 内圆 | StuderWIN / StuderSIM | 厂家页有能力范围，无完整零件 NC | STUDER 产品页 |
| **MIKROSA KRONOS S 250** | 无心 | Siemens 840D sl | 工件 φ1.5~35，切入最长 245，砂轮 φ450×250 | [KRONOS 样本](https://cdn.grinding.com/fileadmin/content_live_2019/www.mikrosa.com/01_pdf/01_brochures/KRONOS_S_V1.1_en.pdf) |
| **KRONOS S 125** | 无心 | 840D sl | 工件约 φ0.5~30，切入最长 120 | 同上 |
| **M1050A** | 无心通磨 | 普通 | 通磨 φ5~50，试件 φ20×90，圆度 0.002 | 无锡华康产品页 |
| **JH18** | 无心切入 | — | 论文给出真实零件尺寸 | [无心磨送料论文](https://www.pincai.com/article/1787256.htm) |

FANUC 磨床固定循环（**不是车床切槽 G75**）：G75 切入、G77 定尺寸切入、G78 连续平面、G79 间歇平面。格式见手册 B-63944EN。  
NUM 磨床循环：G200~G209（外/内圆切入、纵磨、轮廓），见 [NUMgrind](https://www.num.com/fileadmin/documents/Catalogs_Brochures/NUMgrind_Brochure_2023_CHS_view.pdf)。

开源骨架（无具体零件图）：[KND_grinder](https://github.com/YanfeiSun08/KND_grinder)（O0001 调 O9100/O9200/O9300）。

## 案例一览

| 编号 | 机床 | 零件 | 关键尺寸 | 图 | 程序 |
|------|------|------|----------|----|------|
| 1 | STUDER S33 | 光轴 | φ40×120，毛坯 φ40.3，Ra0.4 | `drawings/S33_plain_shaft.png` | `nc/O3301_*.nc` |
| 2 | favoritCNC | 台阶轴 | φ40×85 + φ28×55，总长 140 | `drawings/favoritCNC_step_shaft.png` | `nc/O3302_*.nc` |
| 3 | STUDER S31 | 带肩轴 | φ50×60 + φ32×80 | 尺寸见下 | `nc/O3303_*.nc` |
| 4 | STUDER S41 | 锥度轴 | φ40→φ34，锥长 60 | `drawings/S41_taper.png` | `nc/O3304_*.nc` |
| 5 | KRONOS S 250 | 通磨销 | φ12×80 | `drawings/KRONOS_throughfeed_pin.png` | `nc/O3305_*.nc` |
| 6 | STUDER S122 | 内孔 | φ20×深40，毛坯 φ19.7 | 尺寸见下 | `nc/O3306_*.nc` |
| 7 | JH18 无心 | 细长轴 | 杆 φ12×443，两端 φ7.984±0.016，Ra0.4 | 论文图1（网上） | `nc/O3307_*.nc` |
| 8 | M1050A | 精度试件 | φ20×90，圆度0.002，Ra0.32 | 厂家试件 | `nc/O3308_*.nc` |
| 9 | FANUC 磨床 | 切入循环格式 | G75 I J K Z R F P | 手册 | `nc/O3309_*.nc` |
| 10 | KND | 主程序骨架 | 无零件尺寸 | GitHub | `nc/O0001_*.nc` |

## 尺寸草图（便于识图出码）

**S33 光轴**

```
φ40.3 毛坯 → φ40 成品
|<-------------- 120 ------------->|
O==================================O     Z0 左端，Z-120 右端
```

**台阶轴**

```
φ40×85                 φ28×55
|<------ 85 ------>|<----- 55 ---->|
O==================O===============O     总长 140
```

**锥度**

```
φ40 @ Z0  ---------------->  φ34 @ Z-60
```

**无心通磨**（轴向 Z0 → +L）

```
φ12 × 80   通磨方向 →
```

**JH18 细长轴**（论文）

```
φ7.984          φ12×443           φ7.984
|--小径--|=========================|--小径--|
公差 0.016，Ra0.4，无中心孔
```

## 网上为什么找不到「更多原厂程序」

- STUDER 程序在 StuderWIN 里由图标循环生成，不作为 `.nc` 对外发。
- MIKROSA 走 840D 图形界面，公开资料是样本 PDF，没有零件 NC。
- 论坛上的 G75 绝大多数是**车床切槽**，和磨床 G75 不是同一套。

要用这些测 SAMA「看图出码 / 看码识件」：优先 1、2、4、5。机床型号填表里的型号，图纸用 `drawings/`，程序用对应 `.nc`。

---
kb_version: "mtkb-circuit-2.0.0"
case_id: "CKB-MC160-005"
title: "FAVRETTO MC160：FANUC 0i-TF、光栅尺、手轮与 I/O Link"
domain: "电路"
machine_type: "平面/导轨磨床"
brand: "FAVRETTO"
model: "MC160（待核对是否 MC 160 N）"
source_kind: "用户提供 EPLAN PDF 的页面转写"
verification_status: "图纸封面标识 FAVRETTO MC160；页脚项目字段出现 STUDER/S40-4 7089，归属与器件定值待现场核对"
tags: ["FAVRETTO", "MC160", "FANUC 0i-TF", "电气原理图", "EPLAN"]
---
# FAVRETTO MC160：FANUC 0i-TF、光栅尺、手轮与 I/O Link

> 资料一致性警告：PDF 封面写有“FAVRETTO MC160 / FANUC 0iTF”，但图框页脚同时出现“STUDER / S40-4 / 7089”。因此本案例只能作为待核对图纸，不能在未比对现场线号和元件铭牌前直接施工。

## 1. 功能

连接 CNC 单元、MDI/集成操作面板、X/Z 光栅尺、手轮、串口、主轴模拟量和 I/O Link。

## 2. 具体电路图

### 原图第 7 页

![FAVRETTO MC160：FANUC 0i-TF、光栅尺、手轮与 I/O Link - 原图第 7 页](../assets/favretto_mc160/FAVRETTO_MC160_页07.png)

- [打开完整 16 页原始 PDF](../assets/favretto_mc160/FAVRETTO_MC160_电路图_原始文件.pdf)

## 3. 文字化电路图

```text
24 V/0 V 与 CNC → JA/JF/COP 接口 → X/Z 光栅尺 A/B/Z 差分信号、MPG 手轮 5 V 信号、CB104/CB105/CB106 I/O 单元、主轴模拟量。
```

24 V/0 V 与 CNC → JA/JF/COP 接口 → X/Z 光栅尺 A/B/Z 差分信号、MPG 手轮 5 V 信号、CB104/CB105/CB106 I/O 单元、主轴模拟量。

## 4. 故障诊断与核对点

- 差分编码器/光栅尺必须核对 A±/B±/Z±、5 V 和屏蔽接地。
- 禁止把 24 V 误接入 MPG/光栅尺 5 V 信号端。
- JA、JF、COP 端子定义必须以对应 FANUC 0i-TF 硬件手册和模块型号为准。

## 5. 修改或改造边界

- 元件编号和定值先与现场器件、线号、端子号逐项核对。
- 驱动器、制动电阻、编码器、抱闸和安全输入必须使用对应型号厂家手册。
- 不得仅依据本图确定线径、短路保护、接触器等级或 RC/电阻电容最终参数。
- 上电前执行断电验电、绝缘/接地检查、点对点校线和安全功能测试。

## 6. 来源与验证状态

- 本地来源：`参考资料/FAVRETTOMC160电路图NEW VER.pdf`
- 原图页：7
- 验证状态：图纸封面标识 FAVRETTO MC160；页脚项目字段出现 STUDER/S40-4 7089，归属与器件定值待现场核对
- 整理日期：2026-08-18

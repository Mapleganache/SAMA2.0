# SAMA ↔ EPLAN Electric P8 桥接接口

SAMA 只通过官方 API/脚本创建**全新工程**，不直接写入 `.edb`。

## 许可与版本

本机优先 **EPLAN Electric P8 2.7.3**（`D:\Program Files\EPLAN\Electric P8\2.7.3\Bin\W3u.exe`）。  
2.9.4 常弹「许可并非最新」。SAMA 探测时优先绑定 2.7 → 2.8 → 2.9。

## 自动桥接前提

1. 已安装与许可匹配的 EPLAN P8（本机默认 **2.9.4**），并找到 `W3u.exe`
2. 安装目录含 `Eplan.EplApi.*.dll`（需 **EPLAN API / Openness** 组件）
3. 用户许可覆盖相应 API
4. 运行 `scripts/build-eplan-bridge.ps1` 编译 `Sama.Eplan29Bridge.exe` 到本目录

已交付的 `Sama.Eplan29Bridge.exe` 支持 `--probe` 自检；无 API DLL 时仍为 `bridge-pack` 模式（任务包 + 手工导入）。

桥接命令约定：

```text
Sama.Eplan29Bridge.exe --eplan <W3u.exe> --input <ElectricalProject-v2.json> --output <出目录> --new-project-only
```

成功时应输出新项目、页/元件/连接、项目检查，以及 `.zw1` / PDF / 检查报告。  
桥接不可用或缺 `.zw1` 时，SAMA 只生成明确标记的「EPLAN 导入任务包」，**不假装已生成原生工程**。

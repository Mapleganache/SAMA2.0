# SAMA 2.0

机床维修与电气工程工作站。面向 Windows 10/11 x64，用于机械故障排查、专业电路编辑、G 代码/刀路辅助，以及在已安装官方 EPLAN Electric P8 时导出导入任务包。

## Windows 发行版（推荐）

请到仓库 **发行版 / Releases** 下载当前 Windows 安装包：

- 安装包被拆成多个 `SAMA-1.3.0-windows-x64-setup.7z.00x`（Gitee 单个附件上限 100MB）。
- 把**全部分卷**下到同一目录，用 [7-Zip](https://www.7-zip.org/) 或 Bandizip 打开 `.7z.001` 解压。
- 运行解压得到的 `SAMA-1.3.0-Setup.exe`，可自选安装目录。
- 系统要求：Windows 10/11 **64 位**。未做代码签名，SmartScreen 可能提示“Windows 已保护你的电脑”，点「更多信息」→「仍要运行」。

知识库 SQLite（机械库、MTKB）已打进安装包，安装后即可离线使用。

## 主要功能

- 机械维修工单、诊断步骤与证据归档
- 专业电路编辑器（IEC 元件、正交连线、DRC、全套导出）
- G 代码解析与刀路预览
- 可选：本机已安装并许可的 EPLAN Electric P8 官方 API 桥接；不可用时只生成明确标记的「EPLAN 导入任务包」，不会改写现有 `.edb`

## 从源码运行

需要 Node.js 20+（本机打包时使用 20 LTS）。

```bat
npm install
npm run build
npx electron .
```

或开发编译：

```bat
npm run electron:dev
```

打包 Windows 安装包：

```bat
npm run dist:win
```

产物在 `release/SAMA-1.3.0-Setup.exe`。

导入 MTKB 数据库（仅源码开发需要）：

```bat
npm run import:mtkb
```

## 目录说明

| 路径 | 说明 |
| --- | --- |
| `src/` | 前端（React + Vite） |
| `electron/` | Electron 主进程与本地服务 |
| `resources/` | 知识库资源（SQLite 不进 Git） |
| `tools/eplan-bridge/` | EPLAN 官方 API 桥接源码 |
| `docs/` | 设计与案例说明 |

## 许可与边界

- 本仓库发布的是 SAMA 工作站本身。
- EPLAN、FANUC、SIEMENS 等第三方软件与手册的版权归原厂商。使用 EPLAN 集成时，请在本机安装**正版** EPLAN Electric P8 及厂商许可的 API 组件。
- 不要把任何第三方软件的破解、注册机或许可补丁放到本仓库。

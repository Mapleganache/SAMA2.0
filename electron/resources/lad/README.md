# 内置 LAD

| 文件 | 用途 |
|------|------|
| format_standard_studer.LAD | 格式标准（Studer） |
| empty_0i_shell.LAD | 设计骨架壳（约 20 网：CALLU + 空 SP/SPE + END） |

构建：`node scripts/build-builtin-lad-shells.mjs`

> Fladder `MnemonicToSrc /init=4` 对「仅 SPE/END」会丢梯形（W-4122）；空壳必须保留 CALLU 骨架。

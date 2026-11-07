# 外部数据集：机床数据（E:\机床数据）

原目录 11.65 GB，其中大量是视频课程（mp4/flv/rm，6.8 GB）和 CSF 课件（3.5 GB），不能直接进知识库。本目录只记录**能转成文本**的部分，原始文件留在本机，不进 Git。

## 目录

| 路径 | 内容 | 是否进 Git |
| --- | --- | --- |
| `E:\机床数据` | 原始资料（PDF/Office/视频/CSF） | ❌ |
| `D:\SAMA-data\corpus\机床数据\text\*.jsonl` | 逐页/逐段抽取的文本 | ❌ |
| `D:\SAMA-data\corpus\机床数据\fragments\*.jsonl` | 清洗、繁转简、切片后的片段 | ❌ |
| `D:\SAMA-data\corpus\机床数据\sama_ext.sqlite` | 独立知识库（表结构与 SAMA 一致） | ❌ |
| `docs/datasets/机床数据.manifest.json` | 文件清单、sha256、状态、页数、字符数 | ✅ |

## 处理规则

1. **收录**：有文本层的 PDF、docx/pptx/xlsx、以及用 Word 转换的旧版 `.doc`；
2. **OCR**：无文本层的扫描件用 RapidOCR 逐页识别（标记 `mode=ocr`，未校对）；
3. **舍弃**：视频、CSF 课件、压缩包、安装包、单页尺寸图；
4. **清洗**：去页眉页脚/页码/目录行，OpenCC 繁转简，按标题层级切 500–800 字；
5. **隔离**：全部片段 `reference_allowed=0`、`expert_status=pending`，确认后再分批放开；
6. **版权**：厂商手册与维修书籍版权归原作者，仅内部参考，不外发。

## 重建命令

```powershell
# 1) 旧版 doc 转 docx（需要本机 Word）
#    见 docs/datasets 说明；转换结果在 D:\SAMA-data\corpus\机床数据\converted

# 2) 抽取文本（SKIP_OCR=1 可跳过扫描件）
$env:SKIP_OCR='1'
python -X utf8 D:\SAMA\audit\ingest\extract.py

# 3) 清洗 + 切片
python -X utf8 D:\SAMA\audit\ingest\clean_chunk.py

# 4) 灌库
node D:\SAMA\audit\ingest\load_ext.mjs

# 5) 校验
node D:\SAMA\audit\ingest\validate.mjs
```

## 当前状态

- 88 个文件、5,597 页、约 345 万字符，入库 **4,138 条片段**（约 273 万字符纯净文本）；
- 扫描件 OCR 已完成：533 页（西门子案例集 434、FANUC 29、新代硬件连接 70），未校对；
- 与现有库内容重复 0；
- 片段全部隔离（`reference_allowed=0`），尚未合并进 `sama_full.sqlite`；
- 机型分布：未知 2,370 / 铣·加工中心 1,350 / 车床 383 / 磨床 35；领域：手册 1,339 / PLC 952 / 电气 786 / 参数 736 / 诊断 325。


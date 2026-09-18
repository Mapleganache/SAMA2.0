# 机床智能体前端 API 对接说明（v1）

## 基本信息

- 本地地址：`http://127.0.0.1:8765`
- API 前缀：`/api/v1`
- 数据格式：UTF-8 JSON
- 跨域：已允许 CORS，支持 `GET`、`POST` 和预检 `OPTIONS`
- 资源：图片/PDF/LAD 等通过附件接口返回，支持 `HEAD` 和 HTTP Range
- 兼容旧接口：`/health`、`/search`、`/circuit/plan`

启动：

```bash
python3 mtkb.py serve --port 8765
```

打开 `http://127.0.0.1:8765/` 或 `/api/v1` 可查看当前接口目录。

## 统一响应结构

成功：

```json
{
  "data": {},
  "meta": {},
  "error": null
}
```

失败：

```json
{
  "data": null,
  "meta": {},
  "error": {
    "code": "INVALID_REQUEST",
    "message": "query 为必填字段",
    "details": null
  }
}
```

响应头包含 `X-Request-ID`，前端也可以主动发送该请求头，方便关联日志。

## 接口一览

### GET `/api/v1/health`

检查服务和三个数据库。

### GET `/api/v1/filters`

获取前端筛选器选项：

```json
{
  "domains": ["CNC/NC", "HMI", "机械", "液压气动", "电路", "综合"],
  "machine_types": ["加工中心", "磨床", "车床"],
  "brands": ["FANUC", "STUDER"],
  "models": ["0I-F", "S40-4"]
}
```

### POST `/api/v1/search`

请求：

```json
{
  "query": "伺服电机 报警",
  "domain": "电路",
  "machine_type": null,
  "brand": "FANUC",
  "model": null,
  "page": 1,
  "page_size": 10
}
```

`query` 必填，`page_size` 最大 50。返回结果中的关键字段：

```json
{
  "id": "common:126",
  "database": "common",
  "chunk_id": 126,
  "document_id": "DOC-...",
  "heading": "实例19 数控车床……",
  "excerpt": "用于结果列表的纯文本摘要",
  "plain_text": "去除标签的完整纯文本",
  "content": "图片 URL 已重写的 Markdown/HTML 正文",
  "content_raw": "数据库中的原始正文",
  "content_format": "markdown_with_html",
  "images": [
    {
      "asset_id": "ASSET-...",
      "url": "/api/v1/assets/common/ASSET-...",
      "media_type": "image/jpeg",
      "filename": "xxx.jpg"
    }
  ],
  "urls": {
    "self": "/api/v1/chunks/common/126",
    "document": "/api/v1/documents/common/DOC-..."
  }
}
```

分页信息位于 `meta`：`page`、`page_size`、`has_more`、`next_page`。

### GET `/api/v1/chunks/{database}/{chunk_id}`

读取一条完整正文。`database` 只能是：

- `common`
- `equipment`
- `circuit`

### GET `/api/v1/documents`

分页列出文档：

```text
/api/v1/documents?database=circuit&domain=电路&page=1&page_size=20
```

可选参数：`database`、`domain`、`machine_type`、`brand`、`model`、`page`、`page_size`。

### GET `/api/v1/documents/{database}/{document_id}`

返回文档元数据以及按顺序排列的正文块。为避免整本书一次返回过大，正文块默认每页 20 条，可使用：

```text
?chunk_page=2&chunk_page_size=20
```

分页状态位于 `chunks_pagination`。二进制文档会提供：

```json
{
  "asset": {
    "url": "/api/v1/assets/circuit/ASSET-...",
    "download_url": "/api/v1/assets/circuit/ASSET-...?download=1"
  }
}
```

### GET `/api/v1/assets/{database}/{asset_id}`

浏览器内显示图片/PDF或读取其他附件。添加 `?download=1` 强制作为下载附件。

服务会返回正确的 `Content-Type`、`Content-Length`、`ETag`、缓存头和 `Content-Disposition`。PDF/视频式大文件读取支持 `Range: bytes=...`。

### POST `/api/v1/circuit-plans`

请求示例：

```json
{
  "machine_type": "加工中心",
  "brand": "FANUC",
  "model": "0i-F",
  "change": "加装伺服电机",
  "supply_voltage_v": 380,
  "motor_power_kw": 2,
  "control_voltage_v": 24
}
```

返回 HTTP `201`，方案中的每条证据附带 `chunk` 和 `document` 详情 URL。

### POST `/api/v1/feedback`

请求：

```json
{
  "query_id": "Q-xxxxxxxxxxxx",
  "result": "accepted",
  "note": "已由电气工程师审核"
}
```

`result` 可为 `accepted`、`rejected`、`revised`、`field_verified`。接口只允许写入反馈，不提供隐藏记忆读取能力。

## 前端渲染建议

结果列表使用 `excerpt`，不要直接显示 JSON 或 `content_raw`。

详情页使用 `content`。该字段是 `markdown_with_html`：

1. 先使用支持 GitHub Flavored Markdown 的渲染器；
2. 允许其中的表格 HTML；
3. 在浏览器注入前执行 HTML 白名单清理，禁止脚本、事件属性和危险 URL；
4. 图片路径已经改为后端附件接口，不需要前端再次拼接；
5. 若前端暂未集成富文本渲染器，可先展示 `plain_text` 和 `images`。

推荐页面数据流：

```text
启动 → GET /filters
搜索 → POST /search → 显示 excerpt
打开结果 → GET urls.self → 渲染 content 与 images
打开附件 → 直接使用 asset url
生成方案 → POST /circuit-plans
人工审核 → POST /feedback
```

## TypeScript 类型参考

```ts
type DatabaseKind = "common" | "equipment" | "circuit";

interface ApiResponse<T> {
  data: T | null;
  meta: Record<string, unknown>;
  error: null | { code: string; message: string; details?: unknown };
}

interface ImageAsset {
  ref: string;
  asset_id: string;
  filename: string;
  media_type: string;
  size_bytes: number;
  sha256: string;
  url: string;
}

interface KnowledgeChunk {
  id: string;
  chunk_id: number;
  database: DatabaseKind;
  document_id: string;
  heading: string;
  excerpt?: string;
  content: string;
  content_raw: string;
  content_format: "markdown_with_html";
  plain_text: string;
  images: ImageAsset[];
  domain: string;
  machine_type?: string;
  brand?: string;
  model?: string;
  urls: { self: string; document: string };
}
```

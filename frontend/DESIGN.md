# Smart Data Extractor — 前端设计文档

> 版本：v1（2026-09-24 定稿）
> 状态：设计已确认，待开发
> 配套原型：`mockups/main-interface.html`、`mockups/result-detail-modal.html`（浏览器直接打开）

---

## 1. 背景与目标

后端（Python + Pydantic-AI + FastAPI）已完成 Phase 6：预设/动态 schema 提取、置信度评分、批量并发、成本追踪、155 测试通过。

本前端的目标不是"展示 API 能跑"，而是对齐 Upwork 真实需求
（`job-analysis/2026-09-23-structured-document-extraction-llm-service.md`）所描述的生产级文档提取服务的使用体验：

- **置信度是第一公民**，不是附属指标。界面的核心任务是让用户一眼看出「哪些结果可以信，哪些必须人工复核」。
- 文档进来（PDF / 图片 / 文本）→ 结构化数据出去 → 低置信度的进人工审核队列。
- 绝不假装 100% 准确。needs-review 的路由体验比绝对准确率更重要。

---

## 2. 核心产品决策

### D-F01：取消「单条模式」，只保留统一的批量流程

**理由**：真实业务中不存在"提取一张发票"的场景。用户手上是一批文档；即使只上传一个 PDF，也不能假设它只包含一张发票（多页扫描件很常见）。

**结论**：界面只有一个模式。输入是「一组文件」，输出是「按来源分组的一组结果」。

### D-F02：一个 Input 可能对应多个 Output（1:N）

数据模型必须是两层：

```
Source（一个上传的文件 / 一段手工粘贴文本）
  └── Result[]（该来源里被识别出的 N 条记录）
```

UI 上体现为可折叠的 **Source Group**：组头显示文件名 + 结果数 + 成功/失败统计，展开后是逐条结果行。

### D-F03：文件解析、OCR、文档分割全部由后端负责

前端**只做上传**，不引入 `pdf.js`、`Tesseract.js` 等前端解析库。

理由：
- 分割逻辑（一个 PDF 里有几张发票）需要 LLM 参与，天然属于后端。
- OCR 质量信号（扫描件模糊 → 降置信度）必须和提取管线在同一处产生，前端 OCR 会割裂这条链路。
- 前端保持薄，后端保持可独立交付（JD 明确说"不要前端"，服务本身必须自洽）。

前端职责边界：上传文件 → 轮询/等待结果 → 按 Source 分组渲染 → 导出。

### D-F04：置信度是界面的主视觉信号

- 每条结果行显示**聚合置信度**（进度条 + 数值）。
- 详情页显示**每字段置信度**，并按阈值分三档：
  - `>= 0.85` 高（绿）
  - `0.70 – 0.85` 中（黄）
  - `< 0.70` 低（红）— 触发"需人工复核"提示
- 顶部看板有 `Avg Confidence` 指标。
- 结果区提供 `Need Review` 筛选，一键筛出低置信度记录。

### D-F05：导出先 JSON，Excel 留接口

- v1：单条 Copy JSON / Export JSON；全量 Export All JSON。
- v2：Export Excel（按钮先占位，标注 Coming Soon），需要把 `data` 和 `confidence` 做成并列列或双行表头。

### D-F06：Preset 选中后字段可增删改

Preset 只是"起点模板"，选中后把字段列表展开成可编辑表格：字段名、类型、description 都可改，可增可删。用户必须能预先知道会拿到哪些字段。

编辑后的字段集在提交时走后端的 **custom schema** 通道（`schema` 参数），不再走 `preset`。

### D-F07：国际化 + GitHub 入口

右上角依次：语言切换（EN / 中文）、History、GitHub。
GitHub 链接：https://github.com/Sora130956/smart-data-extractor

---

## 3. 界面结构

### 3.1 主界面（唯一页面）

```
┌──────────────────────────────────────────────────────────────┐
│  Smart Data Extractor              [EN] [History] [GitHub]   │
├──────────────────────────────────────────────────────────────┤
│  Sources │ Extracted │ Failed │ Avg Conf │ Total Cost        │  ← 统计看板
├──────────────────────────────────────────────────────────────┤
│  ┌────────────────────────────────────────────────────────┐  │
│  │              📁  拖拽或点击上传                          │  │
│  │     PDF / 图片 / 文本文件 · 支持多文件 · 后端自动 OCR    │  │
│  └────────────────────────────────────────────────────────┘  │
│  [Mode ▾] [Preset ▾]                    [Start Extraction]   │
│  ── Schema 字段编辑器（选中 Preset 后展开）──                 │
├──────────────────────────────────────────────────────────────┤
│  Extraction Results   [All][High Conf][Need Review] [Export] │
│  ┌ 📄 invoices_batch.pdf · 15 pages    12 ok  1 failed  ▼ ┐  │
│  │   Page 1 │ chips… │ ▓▓▓▓▓ 0.92 │ $0.0002 │ View        │  │
│  │   Page 2 │ chips… │ ▓▓▓▓▓ 0.89 │ $0.0002 │ View        │  │
│  │   Page 3 │ chips… │ ▓▓▓░░ 0.74 │ $0.0002 │ View        │  │
│  └──────────────────────────────────────────────────────┘   │
│  ┌ 🖼️ scanned_receipts.jpg · OCR       4 ok            ▼ ┐  │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

**区块清单**

| 区块 | 内容 |
|---|---|
| Header | 标题 + 语言切换 + History + GitHub |
| Stats Strip | Total Sources / Extracted Items / Failed / Avg Confidence / Total Cost |
| Upload Zone | 拖拽 + 点击，多文件，显示已选文件列表与上传进度 |
| Config Bar | Mode（Preset / Custom Schema）、Preset 选择、Start 按钮 |
| Schema Editor | 字段表格：name / type / description / 删除；底部 + Add Field |
| Results Header | 标题 + 筛选 chips（All / High Confidence / Need Review）+ Export All JSON |
| Source Groups | 可折叠分组，组头含来源图标、文件名、元信息、成功/失败徽章 |
| Result Rows | 序号（Page N / Item N）、字段 chips 预览、置信度条、成本、View |

### 3.2 详情弹窗（点击 View）

| 区块 | 内容 |
|---|---|
| Header | 标题 + Copy JSON / Export JSON / Export Excel(Coming) |
| 警告条 | 存在 `< 0.70` 字段时显示"需人工复核" |
| 字段列表 | 字段名 │ 值 + 来源页码(provenance) │ 置信度徽章 |
| 统计 | Input Tokens / Output Tokens / Cost / Avg Confidence / Fields / Time |
| Raw JSON | 只读代码块，可滚动 |

> 备注：`source_page`（来源页码）目前后端尚未提供，UI 已预留位置。后端补齐前该行留空或隐藏。

---

## 4. 数据模型（前端）

```ts
type SourceType = 'pdf' | 'image' | 'text';
type ResultStatus = 'success' | 'failed';

interface ExtractionSource {
  id: string;
  type: SourceType;
  name: string;              // 文件名，手工输入为 "Manual Input"
  uploadedAt: string;        // ISO
  meta?: string;             // "15 pages" | "OCR processed"
  results: ExtractionResult[];
  stats: {
    succeeded: number;
    failed: number;
    totalCostUsd: number;
    avgConfidence: number;
  };
}

interface ExtractionResult {
  sourceId: string;
  index: string;                        // "Page 1" | "Item 2"
  status: ResultStatus;
  data: Record<string, unknown> | null;
  confidence: Record<string, number>;   // 每字段置信度
  avgConfidence: number;                // 聚合值，用于列表行
  tokensUsed: { input: number; output: number };
  costUsd: number;
  error?: string;
}

interface SchemaField {
  name: string;
  type: 'string' | 'number' | 'integer' | 'boolean' | 'date' | 'array' | 'object';
  description: string;
}
```

置信度分档（单一来源，勿在组件内各写各的）：

```ts
const CONFIDENCE_HIGH = 0.85;
const CONFIDENCE_LOW  = 0.70;
// >= HIGH -> 'high' | >= LOW -> 'medium' | else -> 'low'（需复核）
```

---

## 5. 与后端的契约

### 5.1 现有 API（已实现）

```
GET  /health          -> { status: "ok" }

POST /extract
  { text, preset? | schema?, instructions? }
  -> { data, tokens_used: {input, output}, cost_usd }

POST /batch_extract
  { texts: string[], preset? | schema?, instructions? }
  -> { results: [{ data, tokens_used, cost_usd, error }],
       total_cost_usd, total_tokens, succeeded, failed }
```

约束（来自 `api/schemas.py`）：
- `preset` 与 `schema` **必须恰好提供一个**，否则 422。
- `preset` 取值：`contact` | `invoice` | `lead`。
- `schema` 形状：`{ fieldName: { type, description? } }`，或带 `fields` 包装；每个字段必须有 `type`。
- 批量按条容错：单条失败返回 `data=null` + `error`，不影响整批。

### 5.2 本设计需要的后端新增能力（前端依赖，需后端排期）

| # | 能力 | 说明 | 阻塞程度 |
|---|---|---|---|
| B1 | 文件上传端点 | `POST /extract_files`，multipart 多文件 | **阻塞**，没有它前端无法只传文件 |
| B2 | PDF 文本层解析 + 扫描页 OCR 回退 | 服务端完成 | **阻塞** |
| B3 | 单来源多记录分割 | 一个文件切成 N 条提取单元 | **阻塞**（D-F02 的前提） |
| B4 | 结果按来源分组返回 | 见下方期望响应 | **阻塞** |
| B5 | 置信度随数据一并返回 | 目前混在 `data` 里（如 `xxx_confidence`），需要独立 `confidence` 字段 | 高（可前端临时拆分兜底） |
| B6 | `source_page` provenance | 详情页来源页码 | 中（UI 可先留空） |
| B7 | 长任务进度 | 轮询 `GET /jobs/{id}` 或 SSE | 中（v1 可同步等待 + loading） |

**期望的新端点响应形状**（供后端参考，前端按此实现）：

```jsonc
// POST /extract_files  (multipart: files[], preset|schema, instructions?)
{
  "sources": [
    {
      "name": "invoices_batch.pdf",
      "type": "pdf",
      "meta": "15 pages",
      "results": [
        {
          "index": "Page 1",
          "data": { "invoice_number": "INV-001", "total": 1234.56 },
          "confidence": { "invoice_number": 0.95, "total": 0.92 },
          "tokens_used": { "input": 892, "output": 356 },
          "cost_usd": 0.0002,
          "error": null
        }
      ]
    }
  ],
  "total_cost_usd": 0.0052,
  "total_tokens": { "input": 10240, "output": 3820 },
  "succeeded": 24,
  "failed": 2
}
```

### 5.3 后端就绪前的前端策略

B1–B4 落地前，前端用**手工粘贴文本 + `/batch_extract`** 打通全链路：
每段文本视作一个 Source，产出 1 条 Result（1:1 是 1:N 的特例）。
数据层按 §4 的两层模型写，接口层做适配器隔离，后端端点上线后只改适配器。

---

## 6. 技术栈

| 项 | 选型 | 说明 |
|---|---|---|
| 构建 | Vite | |
| 框架 | React 18 + TypeScript | |
| 样式 | Tailwind CSS | token 见 §7 |
| 请求 | TanStack Query (React Query) | 缓存 + 重试 + loading 状态 |
| 状态 | Zustand | 仅存 schema 编辑器、筛选、语言等 UI 状态 |
| 校验 | Zod | 校验 API 响应，防后端形状漂移 |
| i18n | i18next + react-i18next | EN / 中文 |
| 测试 | Vitest + Testing Library | |

**目录结构**

```
frontend/
├── DESIGN.md
├── mockups/
│   ├── main-interface.html
│   └── result-detail-modal.html
└── src/
    ├── api/            client.ts, adapters.ts, schemas.ts(zod)
    ├── components/
    │   ├── layout/     Header, StatsStrip
    │   ├── input/      UploadZone, ConfigBar, SchemaEditor
    │   ├── results/    ResultsHeader, SourceGroup, ResultRow, ConfidenceBar
    │   └── modal/      ResultDetailModal
    ├── hooks/          useExtraction, useSchemaEditor
    ├── store/          uiStore.ts
    ├── i18n/           en.json, zh.json
    ├── types/          extraction.ts
    └── utils/          confidence.ts, export.ts
```

---

## 7. 视觉规范

```
字号   caption 12/18 · code 13/20 · body 14/20 · title 16/24（上限）
间距   4 / 8 / 12 / 16 / 20 / 24
圆角   radius 8 · card 12 · full 999
```

| Token | Light | Dark |
|---|---|---|
| surface | `#ffffff` | `#0f172a` |
| surface-muted | `#f8fafc` | `#1e293b` |
| border | `#e2e8f0` | `#334155` |
| text | `#0f172a` | `#f1f5f9` |
| text-muted | `#64748b` | `#94a3b8` |
| brand | `#059669` | `#10b981` |
| accent | `#0ea5e9` | `#38bdf8` |
| success | `#10b981` | `#34d399` |
| warning | `#f59e0b` | `#fbbf24` |
| error | `#ef4444` | `#f87171` |

规则：
- 卡片背景一律中性色，语义色只用于置信度、状态徽章、失败提示。
- 支持浅色 / 深色双主题。
- 置信度不能只靠颜色区分，必须同时有数值。

---

## 8. 交互细节

1. **上传**：拖拽高亮边框；多文件排队；每个文件显示上传进度与取消。
2. **提取中**：Start 按钮转 loading；结果区按来源逐个填充（后端支持流式/轮询时）。
3. **Source Group**：默认展开首个、其余折叠；有失败项的组默认展开。
4. **筛选**：`Need Review` = 任一字段 `< 0.70` 或聚合置信度 `< 0.70`。
5. **失败行**：显示 error 文案，操作为 Retry（仅重跑该条）。
6. **Schema 编辑**：改动后 Preset 下拉标记为 "Invoice (modified)"，提交走 custom schema。
7. **语言切换**：即时生效，写入 localStorage。
8. **空态**：未提取时结果区显示引导文案，不显示空表格。

---

## 9. 开发里程碑

| 阶段 | 内容 | 依赖 |
|---|---|---|
| F1 | 项目脚手架、Tailwind token、布局骨架、i18n | — |
| F2 | 文本粘贴 + `/batch_extract` 打通，Source/Result 两层渲染 | 现有 API |
| F3 | 置信度体系：进度条、分档、筛选、详情弹窗 | B5（可前端兜底） |
| F4 | Schema 编辑器 + custom schema 提交 | 现有 API |
| F5 | 文件上传接入 | **B1–B4** |
| F6 | 导出 JSON、History、空态/错误态打磨 | — |
| F7 | Excel 导出 | 后续 |

F5 依赖后端，其余可并行推进。

---

## 10. 未决问题

1. History 存本地（localStorage / IndexedDB）还是后端持久化？→ v1 先 localStorage。
2. 长任务用轮询还是 SSE？→ 待 B7 确认，v1 同步等待。
3. 置信度阈值 0.85 / 0.70 是否可配置？→ v1 硬编码在 `utils/confidence.ts`，后续做成设置项。
4. Excel 导出的置信度列布局（并列列 vs 双行表头）→ F7 再定。

# 项目状态（单一进度源）

> 本文件是项目进度的唯一来源。每次会话结束前必须更新本文件。换会话、换模型都靠它接上进度。

## 当前阶段

第 5 步（生成 → validate → review）— Phase 6 已完成（AC 5/5 通过），Phase 7 部署方案已定（D-018：单服务 + render.yaml），待实际部署验证

## 需求一句话（Who / What / Why）

- **Who（为谁）**：Upwork上需要数据提取服务的客户（特别是$10-400预算的中小型项目）
- **What（做什么）**：一个LLM驱动的数据提取工具，支持从非结构化纯文本中提取结构化数据，提供CLI和API双入口
- **Why（达到什么价值）**：
  - 对客户：将手动整理数据的工作自动化，节省时间和人力成本
  - 对开发者：作为Upwork Portfolio展示Pydantic-AI应用能力，快速破零接单

## 核心定位

**Smart-Data-Extractor**: An LLM-powered toolkit that transforms messy, unstructured text into clean, validated, structured data.

## 范围界定（基于brainstorming结论）

### Day 1-7 MVP包含：
- ✅ 纯文本输入（plain text）
- ✅ 3个预制场景：Contact、Invoice、Lead
- ✅ 用户自定义JSON schema
- ✅ Confidence Score（置信度评分）
- ✅ Validation Rules（email/phone格式验证）
- ✅ Cost Tracking（token用量和成本追踪）
- ✅ Fallback Handling（降级处理）
- ✅ 批量处理（并发控制）
- ✅ CLI + FastAPI双入口
- ✅ 部署到Render
- ✅ Demo视频（2分钟）

### 明确不做（Week 2+按需扩展）：
- ❌ PDF解析（需2-3天，OCR复杂）
- ❌ Excel/CSV读取（需1天）
- ❌ 邮件MIME解析（需1天）
- ❌ Web UI界面（纯API即可）
- ❌ 图片OCR识别（Week 4+）

## 技术栈

（实装版本，已通过 `uv add` 安装并验证导入）

- Python 3.11+
- pydantic 2.13.5（数据验证 + `create_model` 动态 schema）
- pydantic-ai 2.46.0（LLM 结构化输出 + usage 统计 + TestModel 离线测试）
- fastapi 0.141.1 + uvicorn 0.53.0（API 入口）
- typer 0.27.2（CLI 入口）
- httpx 0.28.1
- OpenAI API（gpt-4o-mini，anthropic 包已随依赖安装，可切 Claude）
- pytest 9.1.1 + pytest-asyncio 1.4.0 + respx 0.23.1（测试，`asyncio_mode=auto` 已配）
- Docker + Render（部署）

## 可行性 / 技术选型

**结论：可以做，7 天内能完成 MVP，无技术阻塞项。** 详见 `docs/feasibility.md`。

核验方式：`uv run python spike_feasibility.py`（无需 API key，离线可跑，5/5 通过）

| # | 能力 | 验证结果 |
|---|------|---------|
| 1 | 静态 schema 结构化输出 | ✅ `Agent(model, output_type=Contact)` |
| 2 | 运行时动态 schema | ✅ `pydantic.create_model()` |
| 3 | token usage 统计 | ✅ `result.usage` → input=54 output=2 |
| 4 | 无 API key 离线运行 | ✅ `TestModel` |
| 5 | 成本计算 | ✅ `genai_prices.calc_price` → 1k in/500 out = $0.000450 |

**关键发现（API 变更）**：实装 pydantic-ai 2.46 与原计划文档的旧版 API 不兼容，实现时必须用
`output_type`（非 `result_type`）、`result.output`（非 `result.data`）、`result.usage`（属性非方法）。
详见 D-004。

**成本估算**：开发期总预算 < $0.10；单条提取 $0.00015–0.00036；1000 条批量 < $0.50。

**外部依赖待确认**：OpenAI API Key、Render 账号、本地 Docker 环境。

## 验收标准

详见 `docs/acceptance.md`（5 条可脚本检查的标准）

| AC | 场景 | 核心检查点 |
|----|------|-----------||
| AC-1 | 三个预制场景 | 字段完整性（Contact 12 字段、Invoice/Lead ≥6 字段） |
| AC-2 | 自定义 schema | 输出字段集与输入 schema 严格一致，缺失返回 null |
| AC-3 | Confidence + Validation | confidence ∈ [0.0, 1.0]，格式校验拦截无效 email/phone |
| AC-4 | Cost Tracking + 并发 | 每条有 `tokens_used` / `cost_usd`，批量有聚合，Semaphore(5) 限并发 |
| AC-5 | 离线测试 | 删除 `OPENAI_API_KEY` 后 pytest 全过，零 API 成本 |

**通过标准**：5/5 通过 → 部署；4/5 → 评估是否阻塞；≤3/5 → 返回实现。

## 实现计划

详见 `docs/plan.md`（8 个阶段，7 天完成）

**模块拆分**（按包组织，依赖单向）：
- 底层：`config.py` + `validators/`（formats）
- 模型层：`models/`（base / contact / invoice / lead / dynamic）
- 场景层：`presets/`（base / contact / invoice / lead + PRESETS 注册表）
- 业务层：`extraction/`（agent / extractor / batch / cost）
- 入口层：`api/`（routes / schemas / create_app）+ `cli.py`

依赖方向：`config → validators → models → presets → extraction → api / cli`（不允许反向 import）

**实现顺序**（按依赖关系）：
1. Day 1：基础设施（config + models + validator）
2. Day 2：核心提取逻辑（presets + extractor + cost_tracker）
3. Day 3：批量处理与并发控制（asyncio.Semaphore）
4. Day 4：FastAPI 端点（/extract + /batch_extract + /health）
5. Day 5 上午：CLI 入口
6. Day 5 下午：运行全部 AC 验收，修复失败项
7. Day 6：Docker + Render 部署
8. Day 7：Demo 视频 + README + Proposal 模板

**关键约束**：
- 每个模块完成后写单测再进入下一个
- 全部单测用 `TestModel`（离线，零成本）
- 只在冒烟测试时调真实 API（< 10 次，< $0.01）

## 模块清单

- [x] Phase 1（Day 1，commit ad4c705）：`config.py`、`validators/`（formats）、`models/`（base/contact/invoice/lead/dynamic）— 84 测试
- [x] Phase 2（Day 2）：`presets/`（base/contact/invoice/lead + PRESETS 注册表 + get_preset）、`extraction/`（agent/extractor/cost + extract_data）— 新增 14 测试，共 98 全绿；离线（删 OPENAI_API_KEY）全绿；review 记录 `docs/review.md`
- [x] Phase 3（Day 3）：`extraction/batch.py`（batch_extract：asyncio.gather 并发 + total_cost_usd/total_tokens 聚合，限流由 agent 层共享 ConcurrencyLimiter 承担）— 新增 6 测试，共 115 全绿；离线全绿；review 记录 `docs/review.md`（R-4 转 D-007）
- [x] Phase 4（Day 4）：`api/`（schemas/routes/create_app：/health + /extract + /batch_extract）+ `batch_extract` 容错扩展（return_exceptions + instructions 透传）— 新增 12 测试（batch 3 + api 9），共 127 全绿；离线全绿；review 记录 `docs/review.md`（R-7~R-9）
- [x] Phase 5（Day 5 上午）：`cli.py`（Typer：extract/batch 两命令，契约见 D-009——容错批量 + 退出码 0/1/2 分层 + stdout 数据/stderr 诊断分流）+ `[project.scripts]` 对齐为 `smart-data-extractor = "smart_data_extractor.cli:app"` — 新增 14 测试，共 141 全绿；离线全绿；突变自证通过；review 记录 `docs/review.md`（R-10~R-12，新增 D-009）
- [x] Phase 6（Day 5 下午，AC 5/5 通过）：`fixtures/`（3 场景样本）+ `tests/test_acceptance.py`（14 测试）+ AC-3 修复（`ConfidenceBase` 归零 validator：null 字段 ⇒ 配对 confidence 0.0，preset/动态模型同享）+ `tests/conftest.py`（`fake_openai_env` 提升共享）+ `tests/test_integration.py`（真实 API 冒烟，`RUN_INTEGRATION=1` 触发，默认 skip）— 155 passed / 2 skipped，删 KEY 离线全绿（AC-5）；突变自证通过；acceptance.md 漂移已修正（字段名 / 命令名 / ConcurrencyLimiter）；review 记录 `docs/review.md`（R-13~R-14）
- [ ] Phase 7（Day 6）：Render 部署（D-018：单服务 Native Runtime，非 Dockerfile）——`render.yaml` 已创建，待推送 GitHub 并在 Render 控制台实际部署验证
- [ ] Phase 8（Day 7）：Demo 视频 + README + Proposal 模板

### 前端模块清单（`frontend/`，规格见 `frontend/DESIGN.md` §9）

- [x] F1（脚手架 + token + 骨架 + i18n）：Vite 8.3.1 + React 18.3.1 + TS 5.9.3 + Tailwind v4（CSS-first，`--sde-*` 原始 token + `@theme inline` 映射，light/dark 双主题）+ TanStack Query + Zustand + i18next（EN/中文，`sde.lang` 持久化，`<html lang>` 同步）；组件 Header / StatsStrip / UploadZone / ConfigBar / ResultsHeader / ConfidenceBar / EmptyState / Button；`utils/confidence.ts` 为分档单一来源（0.85 / 0.70）。验证：`tsc -b` exit 0、`vitest run` 10 passed（2 files）、`vite build` exit 0（CSS 12.68 kB / JS 235.72 kB）、浏览器核对四态（light+dark × EN+中文）渲染正常、`sde.theme`/`sde.lang` 刷新后保持、console 无报错
- [x] F2（文本粘贴输入 + `/batch_extract` 打通，Source/Result 两层渲染）：`api/schemas.ts`（Zod 响应校验）+ `api/client.ts`（fetch 封装，`ApiError`）+ `api/adapters.ts`（响应映射 + confidence 拆分）+ `hooks/useBatchExtract.ts`（TanStack Query mutation）+ `PasteTextInput`（粘贴/Add/待处理列表）+ `SourceGroup`/`ResultRow`（Source/Result 两层渲染）+ `App.tsx` 接入真实数据流（stagedTexts 本地 state、mutate 触发、StatsStrip/ResultsHeader 真实统计、EmptyState 条件渲染、请求失败 banner）。范围裁剪：仅支持纯文本（UploadZone 移除渲染但保留代码供 F5 复用）、无 Tab 切换、列表项不支持展开查看全文。验证：`tsc -b --noEmit` exit 0、`vitest run` 34 passed（9 files）、`vite build` exit 0（JS 333.43 kB / CSS 14.31 kB）
  - F2.1（结果 chip 字段标签）：chip 由裸值改为「标签：值」（如 `姓名：张伟`，zh 全角冒号 / en 半角冒号）。链路：App 提交时快照 fieldLabels（preset 路径取 `usePresetSchema`；custom 路径取 `/schema/resolve` 回显的 `display_name`，zod `schemaFieldSpecSchema` 新增 `display_name` 可选列）→ `useBatchExtract` → `adapters` 挂到 `ExtractionSource.fieldLabels` → `SourceGroup` → `ResultRow`（`resultRow.fieldValue` i18n key；无标签时回退裸 key；null/list chip 同样用显示名）。快照随批次走，切预设后旧结果标签不错位。验证：vitest 69 passed（11 files）、tsc exit 0、build exit 0、浏览器实测 contact 预设中文界面 chips 全部带标签
  - F2.2（跨批次累积修复）：连续提取不再清空旧结果——`App.tsx` 不再直接渲染 mutation `data`（每次 mutate 会被替换），改为本地 `sources` state 在 `onSuccess` 前插合并（新批次在最前）；`adapters.ts` 的 source id 由 `text-${i}` 改为 `text-${batchId}-${i}`（batchId 取 `crypto.randomUUID().slice(0,8)`），避免累积后 React key 冲突。验证（先红后绿）：新增 `App.test.tsx` F2 batch accumulation（两批提取旧结果保留 + 新批次在前）与 `adapters.test.ts` 跨批次 id 唯一性测试；vitest 92 passed（13 files）、`tsc -b --noEmit` exit 0
  - F6.1（History，DESIGN.md §10 Q1 拍板 v1 localStorage，无需登录）：`store/historyStore.ts`（`sde.history`，zustand + 手写持久化对齐 uiStore 风格；`HistoryEntry { id, savedAt, presetLabel, sources }` 最新在前，上限 `HISTORY_LIMIT=20` 淘汰最旧，`readHistoryEntries()` 脏 JSON 容错返回空）+ `components/history/HistoryPanel.tsx`（居中 modal，行=presetLabel/时间/来源数/成败/成本，点击行恢复，清空全部，Esc/遮罩关闭）+ App 接线：`onSuccess` 时 `addEntry(newSources, presetLabel)`（label=提交时语言下的预设显示名快照，custom schema 存「自定义字段/Custom Schema」；presets 复用 `['presets']` useQuery 缓存）；恢复走 `withFreshIds()`（id 加随机后缀）前插到 `sources` 最前，防止与屏上同批次 React key 冲突；Header 增加 `onOpenHistory`。TDD：historyStore 8 用例、HistoryPanel 4 用例、App 集成 1 用例（提取→localStorage 记录→面板恢复出第二份），全程先红后绿；F2/F3 afterEach 补 `localStorage.clear()` + historyStore 重置（提取新增历史副作用导致套件内污染）。验证：vitest 117 passed（17 files）、`tsc -b --noEmit` exit 0
- [ ] F3：置信度体系（列 + 筛选）+ 结果详情弹窗
- [ ] F4：Schema 编辑器 + custom schema 模式
- [ ] F5（阻塞于后端 B1–B4）：文件上传
  - F5.1（PDF 上传 + OCR + loading + 按页拆分，D-011/D-012）：PasteTextInput 接 `parse_pdf`（txt/pdf 双通道），`parsing` spinner（role="status"）；`parse_pdf` 返回 `pages: list[str|None]`；Header「⚙ 设置」按钮 → SettingsModal（「文档解析」segmented 开关 whole/pages，`sde.pdfSplitMode` 持久化默认 whole；「模型」分组占位）；pages 模式每页独立来源 `文件名 · P{原页码}`、跳过 null 失败页。验证：后端 196 passed / 2 skipped；前端 116 passed（17 files）+ tsc 0 错误
  - F5.2（图片上传 + OCR，独立 `/parse_image` 端点，D-013）：后端 `extraction/ocr.py` 抽出 `_ocr_images`/`_resolve_model` 复用给新 `parse_image(image_bytes, *, media_type="image/png", ...)`（一图一来源，不拆分）；`api/routes.py` 新增 `POST /parse_image`（`UploadFile` + DI 缝 `get_parse_image_fn`，content-type 白名单 png/jpeg/jpg/bmp，非法 422，复用 `ParsePdfResponse` 响应模型）。前端 `client.parseImage`（复用 `parsePdfResponseSchema`）+ `PasteTextInput` 新增 `imageFiles` 分支（扩展名 png/jpg/jpeg/bmp，始终整图 `onAdd(file.name, text)`，不受 `pdfSplitMode` 影响）+ i18n 文案更新（提及图片 OCR）。验证：后端 203 passed / 2 skipped；前端 121 passed（17 files）+ `tsc -b --noEmit` 0 错误 + `vite build` 成功
- [ ] F6：导出 JSON + History + 空/错态打磨
  - F6.2（导出 Excel，D-014）：`utils/excelExport.ts`（`buildExportModel` 纯函数 → `buildWorkbook` 动态 import ExcelJS → `exportToExcel` Blob 下载）+ ResultsHeader/ResultDetailModal 两处按钮接线（批量 `extraction-results.xlsx` 禁用态对齐 JSON 导出；单条 `${source.name}-${label}.xlsx`）+ i18n 移除「（即将支持）」新增 `excel.*` 词条。两 sheet（提取结果 / 字段置信度，行 1:1），字段列 = 全结果并集首见序 + fieldLabels 首见标签回退裸 key，number/boolean 保留原生类型。TDD 先红后绿：新增 10 用例（util 7 + 组件 3）。验证：vitest 144 passed（18 files）、`tsc -b --noEmit` 0 错误、`vite build` 成功且 exceljs 929 kB 独立懒加载 chunk（主 bundle 377 kB 不变）
  - F5.3（智能推断模板 AI 命名，D-015）：`/schema/infer` 输出模型新增 `schema_name`/`schema_name_en`（双语短名，随响应返回；`SchemaResolveResponse` 可选列向后兼容），前端 `App.tsx` 保存模板改用 AI 名（按 UI 语言优先、互为回退），缺失时回退「智能推断+时间戳」。验证：后端 210 passed / 2 skipped、前端 145 passed + tsc 0 错误，均先红后绿
  - F6.3（导出文件名=模板名+时间戳，D-016）：`ExtractionSource.presetLabel` 提交时快照（`useBatchExtract`→`adaptBatchExtractResponse` 第 5 参）+ 纯函数 `utils/exportFilename.ts`（`buildExportFilename`：模板名-YYYYMMDD-HHmmss.ext，Windows 非法字符替换），批量 ResultsHeader / 单条 ResultDetailModal 的 JSON+Excel 四处统一接入（批量取最新一批 label，旧历史无快照回退 source.name）。修复补记：presetLabel 取值经 `templateName(id)`（保存模板名→预设本地化名→id）统一三处，智能推断路径直接用刚保存的 AI 模板名（首版误用 `history.customSchema`「自定义字段」标签，已删词条）。验证：先红后绿，vitest 150 passed（19 files）+ tsc 0 错误
  - F9（模板下拉与预设编辑保存，D-017）：① 下拉去掉「我的模板」optgroup，预设加本地化前缀「预设：/Preset: 」（`config.presetPrefix`），自定义模板平铺；② uiStore 新增 `presetOverrides`（localStorage `sde.presetOverrides`），SchemaEditor「保存」按钮把预设修改存为该预设的本地覆盖（种子改为 `override ?? presetFields`），自定义模板的保存=updateSavedSchema；③「重置为预设」仅后端预设显示（有覆盖未修改时也可点，重置=清覆盖回后端基线）；④ App 提交条件扩为 `isSchemaModified || isSavedSchema || hasPresetOverride`，带覆盖预设走 /schema/resolve 自定义路径（否则后端原 schema 顶掉用户修改）。顺手修复：setup.ts `URL.createObjectURL` 条件桩改无条件（PasteTextInput 4 个 F7 用例恒红）、App.test makeFile 补 type 第三参（tsc 报错）。验证：先红（23 失败）后绿，vitest 174 passed（19 files）+ tsc 0 错误 + build 成功
  - F9.1（智能推断设为默认且排第一）：uiStore 初始 `preset: SMART_PRESET_ID`（原 'invoice'），ConfigBar 选项顺序改为 智能推断 → 预设（带前缀）→ 自定义模板；测试相应加 beforeEach/renderApp 显式选 invoice 保持既有用例语义，ConfigBar 新增首用例断言默认值 smart 且为第一项。验证：vitest 175 passed（19 files）+ tsc 0 错误 + build 成功
- [x] B-quota（2026-10-09，D-019，demo 阶段配额护栏 + 流量可见性）：`api/quota.py`（`DailyQuota`：单 IP 50/天 + 全站 1000/天双层内存计数，UTC 翻转清零，XFF 首段取 IP）挂到 5 个计费端点（`enforce_daily_quota` 依赖）+ `/batch_extract` 按 `len(texts)` 扣；429 返回结构化 `{code, message, reset_at}`，前端 `client.ts` 解析 `ApiError.code` + `utils/errors.ts` 映射 i18n（提取 banner 与 PDF/图片解析错误两处双语友好提示）；新增 `GET /stats?token=`（未配 `ADMIN_STATS_TOKEN` 时 404 隐藏）。**DEMO-STAGE 专用：宣发前必须替换为按用户配额**（quota.py docstring 与 commit message 均已标注）。验证：后端 226 passed / 2 skipped（新增 14 测试，突变自证通过）；前端 184 passed（串行全量，并发满载下 excelExport 偶发超时与本次无关）+ tsc 0 错误
- [x] Issue-1（2026-10-10，D-020，复核字段保留原始提取值）：GitHub Issue #1——复核覆盖 `data[fieldKey]` 后原始值无处可寻，导出无法对比 LLM 答案与人工修正。修复：`ExtractionResult.originalData?`（仅首次编辑快照，re-edit 保留首快照）+ 共享纯函数 `utils/review.ts#applyFieldEdit`（App 屏上/modal 与 historyStore 持久化镜像两处复用，快照语义一致）；JSON 导出零改动自动携带；Excel results sheet 对任意行复核过的字段插「{字段}（原始）/(Original)」伴随列（i18n `excel.originalColumn`，仅该行已复核才填值，无复核保持原布局）；详情弹窗已复核字段显示「原始值 X / Original value X」（`resultDetail.originalValue`）。UI 打磨（用户反馈）：字段名列 140px 内 `self-center text-center` 居中，值区改 `flex-wrap items-baseline` 让当前值与原始值同行 baseline 排列（放不下自动换行），消除行高参差。纯前端改动，后端无涉。TDD 先红（5 失败）后绿：新增 `review.test.ts` 6 用例 + historyStore/excelExport/Modal/App 扩展；前端 197 passed（21 files，串行）+ tsc 0 错误 + build 成功（exceljs chunk 不变）；突变自证（快照改写 newValue → 7 测试红再还原）；浏览器端到端实测（发票预设 → 编辑供应商 → 弹窗「Acme Corporation Ltd / 原始值 Acme Corp / 已复核」、localStorage 与导出 JSON 均含 originalData、导出 Excel 无报错）
- [x] Issue-2（2026-10-10，D-021，字段级最低置信度阈值触发复核）：GitHub Issue #2——每字段可配置最低置信度，任一字段低于其阈值触发人工复核（用户拍板：配置入口随字段编辑）。实现：`SchemaField.minConfidence?`（前端专属不发给后端，SchemaEditor 新增「最低置信度」number 列，空→null、clamp [0,1]，随 savedSchemas/presetOverrides 持久化）→ 提交时 `buildReviewThresholds` 快照到 `ExtractionSource.reviewThresholds`（D-016 惯例，后续 schema 编辑不重判旧批次；custom 路径经 resolve 回显 re-key、field_name 优先 display_name）→ 判定收敛 `confidence.ts`（`fieldThreshold` 字段级→0.70 回退、`needsReview`/`belowThresholdFields` 接受 `thresholds`）→ App 筛选计数与 ResultDetailModal 警告条全走 source 快照，警告文案列出各字段及其阈值（`Invoice Number (0.99)`）。纯前端改动。TDD 分层先红后绿：confidence +3 / review +4 / SchemaEditor +4 / adapters +3 / ResultDetailModal +1；全量 vitest 215 passed（21 files）+ tsc 0 错误 + build 成功；突变自证（回退改 0.9 → 3 红再还原）；同日 UI 调整（D-021 补记）：自由数值输入改四档预设 select（严格 0.9/较严 0.8/默认 0.70/宽松 0.5，「默认」档存 null 回退全局，旧遗留非档位值渲染为独立 option），`parseMinConfidence` 删除、i18n 四档词条替代 placeholder；全量 216 passed + tsc 0 错误 + build 成功；同日增补（D-022，用户拍板「是否允许为空」，同一 issue）：`SchemaField.allowEmpty?`（默认不允许＝现状零回归，后端把 null 字段 confidence 归零 0.0 故空值本就触发复核）→ 提交时 `buildAllowEmptyFields` 快照到 `ExtractionSource.allowEmptyFields`（例外清单，`review.ts` 抽公共 `keyedFields` 供 thresholds/allowEmpty 共用 re-key）→ `confidence.ts` 新增 `isEmptyValue`/`emptyViolatingFields`，空值字段不再参与阈值判定改走「不允许为空」规则，豁免仅覆盖空值（有值仍按阈值判）→ App 筛选计数与 Modal 警告条传 `data`+`allowEmpty`，警告拆「低于置信度」「不允许为空」两段归因更准；SchemaEditor 增「允许为空」两档 select（92px）。纯前端改动。TDD 先红（5 文件 15 失败）后绿（92 passed）；全量 vitest 235 passed（21 files；excelExport 首轮并发超时为既有抖动，重跑通过）+ tsc 0 错误 + build 成功；同日重构（D-023，用户拍板"允许为空但置信度又有要求太困惑"）：撤销独立列，并入最低置信度第五档「允许为空 (0.0)」——删 `SchemaField.allowEmpty`，`buildAllowEmptyFields` 谓词改 `minConfidence===0`（0.0 档同时进 thresholds/allowEmpty 两快照：非空低分 ≥0 通过 + 空值豁免空值规则），语义收紧为完全免检（可选字段不设质量门槛）；判定内核/快照/Modal 警告/App 计数零改动；顺手给 excelExport buildWorkbook 加 20s 超时修掉 D-019 既有并发 flake。TDD 先红（5 失败）后绿（91 passed）；全量 234 passed + tsc 0 错误 + build 成功

## 可视化约定（docs/view/）

- `docs/view/day{N}-project-tree.html`（项目理解树）与 `day{N}-dependency-graph.html`（包依赖+调用点图）按天版本化
- 每个 Phase 结束或结构变化时：**基于上一版文件演进**生成新版本（day2 → day3 …），不覆盖旧版，浏览器直接打开可看
- 依赖图连线上必须标注实际调用的函数/属性（如 `get_preset()`），次级依赖（如 agent.py 读 config.max_concurrency）在包 docstring 登记

## 下一步动作

**前端 F3（当前主线）**：置信度体系（列 + 筛选）+ 结果详情弹窗。

**后端 Phase 7（Day 6，可并行）：Render 部署（D-018）**——方案已定：单服务 Native Runtime（FastAPI 挂载前端构建产物 `StaticFiles`，同源无需 CORS），`render.yaml` 已创建于项目根目录。剩余步骤：① 推送 GitHub（含 `render.yaml`）；② Render 控制台导入 Blueprint；③ 手填 `OPENAI_API_KEY`（必需）/`GLM_API_KEY`（可选）；④ 验证 Build/Start 成功、`/health` 返回正常；⑤ 线上冒烟一次 `/extract`。可选前置：用户拍板后跑 `RUN_INTEGRATION=1` 真实 API 冒烟（R-14，2 次调用 < $0.01，验证 R-2 instructions 送达）。

## 决策摘要

（本次会话新增的决策摘要，详情见 `.harness/decisions.md`）

### D-001: 输入格式选择
- 决策：Day 1-7 MVP只支持纯文本，PDF/Excel延后
- 理由：纯文本覆盖80%需求，技术复杂度最低，7天可完成
- 详见：`.harness/decisions.md`

### D-004: 锁定 pydantic-ai 2.46 API 写法
- 决策：以 `spike_feasibility.py` 为唯一 API 参考，不照抄原计划文档代码片段
- 理由：2.46 存在 4 处破坏性变更（output_type / result.output / result.usage 属性 / 内置价格表）
- 详见：`.harness/decisions.md`

### D-005: 提取层用模型注入做离线测试
- 决策：`extract_data(..., model=...)` 依赖注入模型实例（测试传 TestModel），生产默认取 settings.model；genai_prices 的 Decimal 统一转 float 返回
- 理由：符合 workspace 测试纪律（注入 fake 而非 mock 被测对象）；注入路径下 cost 按 DEFAULT_MODEL_REF=gpt-4o-mini 计价
- 详见：`.harness/decisions.md`

### D-006: 并发限流、成本来源与 Agent 缓存（用户四问驱动）
- 决策：成本优先用框架自动填充的 `usage.cost`（calculate_cost 降级为 fallback）；限流用跨 agent 共享的 `ConcurrencyLimiter`（Phase 3 不再手写 Semaphore）；生产预设 Agent 用 lru_cache 缓存复用连接池；统一 temperature=0
- 理由：usage.cost 由 pydantic-ai 自动填充属权威来源；每次新建 Agent 会丢连接池且各自限流等于没有全局限流
- 详见：`.harness/decisions.md`

### D-007: batch 层失败语义——保持 fail-fast
- 决策：`batch_extract` 维持裸 `asyncio.gather`（fail-fast）；per-item 容错（error 字段、部分成功聚合口径）推迟到 Phase 4 定义 API 响应契约时统一设计
- 理由：容错口径属返回契约变更，应由传输层需求驱动；batch 层单方面决定会导致 Phase 4 返工
- 详见：`.harness/decisions.md`（来源：Phase 3 review R-4）— **已由 D-008 闭环**

### D-008: API 契约——批量部分容错 + instructions 双端点暴露 + 错误分层
- 决策：/batch_extract 用部分容错（200 + 统一形状 error 字段 + succeeded/failed 计数，聚合只计成功），`batch_extract` 加 `return_exceptions`（默认 fail-fast 向后兼容）；instructions 在 /extract 和 /batch_extract 都暴露；错误分层 422（DTO 形状）/400（业务 ValueError）/500
- 理由：符合 D-003 Fallback Handling 定位；DTO 校验前置让路由保持薄；schema 字段用 alias 避免遮蔽 BaseModel.schema
- 详见：`.harness/decisions.md`（来源：Phase 4 设计对齐，用户拍板）

### D-009: CLI 契约——容错批量 + 退出码分层 + 数据/诊断流分离
- 决策：batch 固定容错模式（部分结果仍写出，任一失败 exit 1）；退出码 0/1/2 分层对应 API 200/400/422；stdout 只放数据 JSON、stderr 放汇总与错误；入口名沿用 `smart-data-extractor` → `cli:app`
- 理由：CLI 面向脚本管道消费，数据/诊断必须分流；退出码是脚本判断批处理结果的唯一手段；D-008 已授权自选语义
- 详见：`.harness/decisions.md`（来源：Phase 5 实现，plan 5.1 的 `extractor` 命令名与之偏差，以本决策为准）

### D-010: preset description 双语化（按 UI 语言取列 + 互为回退）
- 决策：`schema_fields.description` 拆 `description_zh`/`description_en` 双列；`zh*` 优先 zh 回退 en，否则反之；前端 `i18n.resolvedLanguage` 经 `/extract`、`/batch_extract` 可选 `lang` 透传到 `get_preset`/`get_preset_agent`（lang 进缓存键）；`PresetFieldInfo` 与前端 schema 暴露双语列；`/schema/resolve` 保持单语言
- 理由：中文界面描述显示英文且发给 LLM 的描述语言不可控；单语言自定义字段与 preset 统一走同一回退规则
- 详见：`.harness/decisions.md`（commits：a592b66 / fa9dd03 / 1b5732b / 5129618 / fe4a846；后端 168 passed / 2 skipped，前端 typecheck+62 tests+build 全绿）

### D-011: GLM OCR 响应缺 `object` 字段兼容
- 决策：`GlmChatModel(OpenAIChatModel)` 覆写 `_validate_completion` 钩子回填缺失的 `object`；`build_glm_model` 加 `http_client` 注入缝，回归测试用 `httpx2.MockTransport`（respx 不兼容 httpx2，拦不住 openai 3.16 的调用链）
- 理由：智谱端点响应无 `object` 字段，openai SDK 不校验透传 None，pydantic-ai 2.46 严格复校验 Literal 拒绝 → OCR 全页失败
- 详见：`.harness/decisions.md`（验证：先红后绿，全量 196 passed / 2 skipped）

### D-012: PDF 解析方式设置——header 设置面板 + 按页拆分来源
- 决策：`parse_pdf` 返回 `pages: list[str|None]`（页数等长、失败页 None）；前端 Header「设置」→ SettingsModal 内 segmented 开关（`sde.pdfSplitMode` 持久化，默认 whole，含「模型」分组占位）；pages 模式每页独立来源 `文件名 · P{原页码}`
- 理由：一份 PDF 可能含多条记录，整份拼接只能抽出一条；`batch_extract` 天然支持多来源，前端拆分零后端往返
- 详见：`.harness/decisions.md`（验证：后端 196 passed / 2 skipped；前端 116 passed + tsc 0 错误）

### D-014: Excel 导出——前端 ExcelJS 动态导入 + 两 sheet
- 决策：纯前端生成 .xlsx（结果数据只在前端累积 state）；`buildExportModel` 纯函数层 + 动态 import ExcelJS（懒加载 chunk）+ 两 sheet（结果/字段置信度行 1:1）；单条导出复用同一入口
- 理由：后端 openpyxl 需全量回传无意义；SheetJS npm 版停更；两 sheet 保持数据纯度利于下游处理
- 详见 `.harness/decisions.md`（验证：vitest 144 passed、tsc 0 错误、build 成功 exceljs 独立 chunk）

### D-015: 智能推断模板命名——AI 生成 schema_name 双语列
- 决策：`/schema/infer` 让 LLM 随字段一并生成 `schema_name`（输入文本语言短名）+ `schema_name_en`；前端保存模板按 UI 语言取 AI 名（互为回退），缺失回退「前缀+时间戳」
- 理由：命名上下文在同一次 LLM 调用里，零额外成本；双语回退沿用 D-010 惯例
- 详见 `.harness/decisions.md`（验证：后端 210 passed / 2 skipped、前端 145 passed + tsc 0 错误，先红后绿）

### D-016: 导出文件名——模板名快照 + 紧凑时间戳
- 决策：`ExtractionSource.presetLabel` 提交时快照；`utils/exportFilename.ts` 统一生成 `模板名-YYYYMMDD-HHmmss.ext`（非法字符替换），批量/单条、JSON/Excel 四处接入，无快照回退 source.name
- 理由：结果跨批次累积，导出时的当前模板未必是结果来源，快照到 source 才准确
- 详见 `.harness/decisions.md`（验证：先红 6 失败后绿，vitest 150 passed + tsc 0 错误）

### D-018: Render 部署方案——单服务（FastAPI 挂载前端构建产物）+ Blueprint
- 决策：FastAPI 用 `StaticFiles(html=True)` 挂载 `frontend/dist` 同源伺服，无需 CORS；新增 `render.yaml`（Native Runtime，`buildCommand` 串联 `uv sync --no-dev` + 前端构建，`startCommand` 绑 `$PORT`，`healthCheckPath: /health`）；密钥（`OPENAI_API_KEY`/`GLM_API_KEY`）用 `sync: false` 控制台手填
- 理由：前端已硬编码 `/api/xxx` 相对路径，同源部署零改动；Native Runtime 预装 Node 工具链免维护 Dockerfile；`uv.lock` 锁版本保证与本地一致
- 详见 `.harness/decisions.md`

### D-019: demo 阶段每日用量护栏（单 IP 50/天 + 全站 1000/天，内存计数）+ /stats 流量可见性
- 决策：`DailyQuota` 内存双层计数挂全部计费端点（batch 按条数扣），429 结构化载荷 + 前端双语友好提示；`GET /stats?token=`（`ADMIN_STATS_TOKEN` 未配则 404 隐藏）提供当日用量/独立 IP/按端点计数。**demo 阶段专用，正式宣发前替换为按用户配额/持久化限流**（代码注释与 commit 均已标注）
- 理由：无用户体系下 IP 是唯一无摩擦标识但可伪造，全站总额才是预算兜底；SQLite 持久化在 Render 免费层（部署即清盘）无收益；umami/GA 留作宣发后升级项
- 详见 `.harness/decisions.md`（验证：后端 226 passed / 2 skipped 含突变自证；前端 184 passed + tsc 0 错误）

### D-021: 字段级最低置信度阈值（minConfidence 随字段编辑 + 提交时快照）
- 决策：阈值挂 `SchemaField.minConfidence`（SchemaEditor 列内编辑，随模板/预设覆盖持久化）；提交时 `buildReviewThresholds` 快照到 `ExtractionSource.reviewThresholds`（D-016 惯例）；`fieldThreshold` 字段级→0.70 回退，`needsReview` 任一字段低于其阈值即触发；筛选计数与详情警告全走 source 快照并列出各字段阈值
- 理由：字段间重要度差异（发票号 0.99 vs 备注 0.5）无法用全局一刀切表达；快照避免改阈值追溯翻动已复核批次；纯前端改动后端无涉
- 详见 `.harness/decisions.md`（验证：全量 215 passed + tsc 0 错误 + build 成功；突变自证 3 红再还原）

# 项目状态（单一进度源）

> 本文件是项目进度的唯一来源。每次会话结束前必须更新本文件。换会话、换模型都靠它接上进度。

## 当前阶段

第 5 步（生成 → validate → review）— Phase 6 已完成（AC 5/5 通过），准备进入 Phase 7（Docker + Render 部署）

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
- [ ] Phase 7（Day 6）：Docker + Render 部署
- [ ] Phase 8（Day 7）：Demo 视频 + README + Proposal 模板

### 前端模块清单（`frontend/`，规格见 `frontend/DESIGN.md` §9）

- [x] F1（脚手架 + token + 骨架 + i18n）：Vite 8.3.1 + React 18.3.1 + TS 5.9.3 + Tailwind v4（CSS-first，`--sde-*` 原始 token + `@theme inline` 映射，light/dark 双主题）+ TanStack Query + Zustand + i18next（EN/中文，`sde.lang` 持久化，`<html lang>` 同步）；组件 Header / StatsStrip / UploadZone / ConfigBar / ResultsHeader / ConfidenceBar / EmptyState / Button；`utils/confidence.ts` 为分档单一来源（0.85 / 0.70）。验证：`tsc -b` exit 0、`vitest run` 10 passed（2 files）、`vite build` exit 0（CSS 12.68 kB / JS 235.72 kB）、浏览器核对四态（light+dark × EN+中文）渲染正常、`sde.theme`/`sde.lang` 刷新后保持、console 无报错
- [x] F2（文本粘贴输入 + `/batch_extract` 打通，Source/Result 两层渲染）：`api/schemas.ts`（Zod 响应校验）+ `api/client.ts`（fetch 封装，`ApiError`）+ `api/adapters.ts`（响应映射 + confidence 拆分）+ `hooks/useBatchExtract.ts`（TanStack Query mutation）+ `PasteTextInput`（粘贴/Add/待处理列表）+ `SourceGroup`/`ResultRow`（Source/Result 两层渲染）+ `App.tsx` 接入真实数据流（stagedTexts 本地 state、mutate 触发、StatsStrip/ResultsHeader 真实统计、EmptyState 条件渲染、请求失败 banner）。范围裁剪：仅支持纯文本（UploadZone 移除渲染但保留代码供 F5 复用）、无 Tab 切换、列表项不支持展开查看全文。验证：`tsc -b --noEmit` exit 0、`vitest run` 34 passed（9 files）、`vite build` exit 0（JS 333.43 kB / CSS 14.31 kB）
  - F2.1（结果 chip 字段标签）：chip 由裸值改为「标签：值」（如 `姓名：张伟`，zh 全角冒号 / en 半角冒号）。链路：App 提交时快照 fieldLabels（preset 路径取 `usePresetSchema`；custom 路径取 `/schema/resolve` 回显的 `display_name`，zod `schemaFieldSpecSchema` 新增 `display_name` 可选列）→ `useBatchExtract` → `adapters` 挂到 `ExtractionSource.fieldLabels` → `SourceGroup` → `ResultRow`（`resultRow.fieldValue` i18n key；无标签时回退裸 key；null/list chip 同样用显示名）。快照随批次走，切预设后旧结果标签不错位。验证：vitest 69 passed（11 files）、tsc exit 0、build exit 0、浏览器实测 contact 预设中文界面 chips 全部带标签
- [ ] F3：置信度体系（列 + 筛选）+ 结果详情弹窗
- [ ] F4：Schema 编辑器 + custom schema 模式
- [ ] F5（阻塞于后端 B1–B4）：文件上传
- [ ] F6：导出 JSON + History + 空/错态打磨

## 可视化约定（docs/view/）

- `docs/view/day{N}-project-tree.html`（项目理解树）与 `day{N}-dependency-graph.html`（包依赖+调用点图）按天版本化
- 每个 Phase 结束或结构变化时：**基于上一版文件演进**生成新版本（day2 → day3 …），不覆盖旧版，浏览器直接打开可看
- 依赖图连线上必须标注实际调用的函数/属性（如 `get_preset()`），次级依赖（如 agent.py 读 config.max_concurrency）在包 docstring 登记

## 下一步动作

**前端 F3（当前主线）**：置信度体系（列 + 筛选）+ 结果详情弹窗。

**后端 Phase 7（Day 6，可并行）：Docker + Render 部署**——① 写 `Dockerfile`（uv 或 pip 安装、非 root 用户、健康检查）；② `.dockerignore`；③ 本地 `docker build && docker run` 验证 /health；④ Render 部署（环境变量 `OPENAI_API_KEY`、`MODEL` 等）；⑤ 部署后线上冒烟（/health + 一次 /extract）。可选前置：用户拍板后跑 `RUN_INTEGRATION=1` 真实 API 冒烟（R-14，2 次调用 < $0.01，验证 R-2 instructions 送达）。

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

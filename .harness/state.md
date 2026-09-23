# 项目状态（单一进度源）

> 本文件是项目进度的唯一来源。每次会话结束前必须更新本文件。换会话、换模型都靠它接上进度。

## 当前阶段

第 5 步（生成 → validate → review）— Phase 2 已完成，准备进入 Phase 3

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
- [ ] Phase 3（Day 3）：`extraction/batch.py`（Semaphore 并发批量）
- [ ] Phase 4（Day 4）：`api/`（/health + /extract + /batch_extract）
- [ ] Phase 5（Day 5 上午）：`cli.py`（Typer）
- [ ] Phase 6（Day 5 下午）：AC-1~AC-5 验收 + fixtures/
- [ ] Phase 7（Day 6）：Docker + Render 部署
- [ ] Phase 8（Day 7）：Demo 视频 + README + Proposal 模板

## 可视化约定（docs/view/）

- `docs/view/day{N}-project-tree.html`（项目理解树）与 `day{N}-dependency-graph.html`（包依赖+调用点图）按天版本化
- 每个 Phase 结束或结构变化时：**基于上一版文件演进**生成新版本（day2 → day3 …），不覆盖旧版，浏览器直接打开可看
- 依赖图连线上必须标注实际调用的函数/属性（如 `get_preset()`），次级依赖（如 agent.py 读 config.max_concurrency）在包 docstring 登记

## 下一步动作

**Phase 3：实现 `extraction/batch.py`**——`batch_extract(texts, preset, schema_dict)`，asyncio.gather 并发，聚合 total_cost_usd / total_tokens。**注意 D-006 设计变更：限流已由 agent 层的共享 `ConcurrencyLimiter` 承担，batch.py 不再手写 Semaphore**。先写 `tests/extraction/test_batch.py`（TDD）。

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

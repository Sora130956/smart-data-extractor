# Code Review 记录

> 第 5.5 步：每个模块完成后 review 一次，问题记录在此。

---

## Phase 2 review（2026-09-23，presets/ + extraction/）

### 检查过程

- 依赖方向：`presets → models`，`extraction → presets/models/config`，无反向 import ✅
- pydantic-ai 2.46 API：`output_type` / `instructions` / `result.output` / `result.usage`（属性），与 D-004 一致 ✅
- 测试纪律：TestModel 依赖注入（非 mock 被测对象）；删除 `OPENAI_API_KEY` 后 98/98 通过；改坏 exactly-one 校验后 5 个测试变红，还原后全绿 ✅

### 已记录问题

| # | 级别 | 问题 | 处理 |
|---|------|------|------|
| R-1 | 仅供参考 | `extractor.DEFAULT_MODEL_REF` 硬编码 `gpt-4o-mini`：注入非字符串 model（如 TestModel）且未传 `model_ref` 时，成本按此价目计算。若日后更换默认模型，该路径会静默漂移。 | **已缓解（2026-09-23 二轮）**：`_resolve_cost` 优先用框架自动填充的 `usage.cost`，`DEFAULT_MODEL_REF` 仅在无价目模型的 fallback 路径生效，生产真实模型不再经过它 |
| R-2 | 仅供参考 | TestModel 不消费 `instructions`，prompt 内容只在 registry 测试中断言了关键词，无法离线验证"instructions 真的送达模型"。 | 暂不处理：Day 6 冒烟测试用真实 API 验证 prompt 生效（< 10 次调用） |
| R-3 | 仅供参考 | `genai_prices.calc_price` 对未知 `model_ref` 会抛异常，当前未兜底。 | 暂不处理：model_ref 来源只有两处（settings / 显式参数），均属内部可信输入，不属于系统边界 |

### 结论

无必须修复项，Phase 2 通过 review。

---

## Phase 2 二轮 review（2026-09-23，用户四问驱动）

### 用户质询 → 发现 → 处理

| 质询 | 核实结果 | 处理 |
|------|---------|------|
| `Type[BaseModel]` 语义 | 类对象（非实例），Agent 内部实例化 | 无需改，已答疑 |
| 限流/重试/fallback/model_settings | Agent 有原生 `max_concurrency` + 可共享 `ConcurrencyLimiter`；手写 Semaphore 只在"每次新建 agent"时才必要 | **改用共享 `ConcurrencyLimiter`**，Phase 3 batch 不再手写 Semaphore；补配 `ModelSettings(temperature=0)` |
| usage 里没有现成美元吗 | **有**：`RunUsage.cost` 由框架按 genai_prices 自动填充（`_agent_graph.py:1778`），TestModel 无价目才为 None | **重构**：`_resolve_cost` 优先 `usage.cost`，`calculate_cost` 降级为 fallback |
| 每次构建 Agent 的资源问题 | 字符串 model 构造是 eager 的（立即建 provider + AsyncOpenAI client），每次新建丢失连接池 | **缓存**：`get_preset_agent` 用 `functools.lru_cache` 按 `(preset_name, model_ref)` 缓存（天然有界）；动态 schema 不缓存（防内存泄漏） |

### 验证

- 新增 7 测试（agent 缓存 5 + cost 解析 2），先 RED 后 GREEN
- 自证：`lru_cache(maxsize=None→0)` 后缓存身份测试变红，还原后 105 全绿

### 结论

四处质询全部落实，无遗留必须修复项。

---

## Phase 3 review（2026-09-23，extraction/batch.py）

### 检查过程

- 依赖方向：`batch.py` 仅 import 同层 `extractor.py`，无反向 import ✅
- D-006 合规：batch.py 无手写 Semaphore，限流完全由 agent 层共享 `ConcurrencyLimiter` 承担 ✅
- 测试纪律：TestModel 依赖注入；先 RED（ImportError）后 GREEN；改坏 `total_tokens` 聚合后 `test_batch_aggregates_cost_and_tokens` 变红（assert 0 == 156），还原后全绿 ✅
- 离线：删除 `OPENAI_API_KEY` 后 115/115 通过 ✅

### 已记录问题

| # | 级别 | 问题 | 处理 |
|---|------|------|------|
| R-4 | 建议修改 | `asyncio.gather` 未用 `return_exceptions=True`：生产中单条文本失败（如 API 抖动）会让整批抛异常；且 gather 传播首个异常时**不取消**其余任务，后台任务仍消耗 token。 | **暂不处理，转 D-007**：plan 3.1 明确 plain gather；加 `return_exceptions` 需引入 per-item error 字段，属于返回契约变更，应留到 Phase 4 定义 API 响应契约时统一设计，batch 层不单方面做决定 |
| R-5 | 仅供参考 | `batch_extract` 未透传 `extract_data` 的 `model_ref` / `instructions` 参数。 | 暂不处理：plan 3.1 签名只有 `model` 注入缝；Phase 4 API 需要时加参是向后兼容扩展 |
| R-6 | 仅供参考 | TestModel 输出不回显输入文本，离线无法验证"results 顺序与输入顺序一致"；顺序正确性依赖 `asyncio.gather` 的语义保证。 | 暂不处理：gather 保序是框架契约，已在 batch.py 注释中登记 |

### 结论

无必须修复项，Phase 3 通过 review。R-4 已升级为 D-007 跟踪。

---

## Phase 4 review（2026-09-24，api/ 包 + batch 容错扩展）

### 检查过程

- 依赖方向：`api → extraction`（routes.py 调 extract_data / batch_extract）、`api → presets`（schemas.py 查 PRESETS 成员），均为上层→下层，无反向 import ✅
- D-007 闭环：批量失败语义经用户拍板为部分容错，`batch_extract` 加 `return_exceptions`（默认 False 保持 fail-fast 向后兼容），API 层固定传 True ✅
- 测试纪律：API 测试全程 `dependency_overrides` 注入 fake（httpx.ASGITransport，零网络）；batch 新测试用 monkeypatch 替换模块级依赖 `extract_data`（打的是依赖缝，非被测对象本身）；改坏 `succeeded=len(items)-failed` 为 `len(items)` 后 `test_batch_partial_failure_contract` 变红（assert 3 == 2），还原后全绿 ✅
- 离线：删除 `OPENAI_API_KEY` 后 127/127 通过；plugins 行含 asyncio-1.4.0（AUTO），无 RuntimeWarning ✅
- 冒烟：`app.openapi()` 确认 /health /extract /batch_extract 三端点注册（注意：FastAPI 0.141 的 `app.routes` 里 include_router 是惰性 `_IncludedRouter`，直接看 app.routes 会误以为路由缺失）✅

### 已记录问题

| # | 级别 | 问题 | 处理 |
|---|------|------|------|
| R-7 | 仅供参考 | routes 里 `ValueError → 400` 的兜底在 DTO 校验（422）之后几乎不可达；而 `create_dynamic_model` 对极端字段名（如 `model_` 前缀、非法标识符）抛的非 ValueError 异常会 500。 | 暂不处理：DTO 已挡住形状错误，深层 pydantic 异常属低频边界；400 兜底保留作安全网。若 Day 6 冒烟发现真实案例再收敛 |
| R-8 | 仅供参考 | 批量 error 字段透传异常类型名 + 消息（`"ValueError: ..."`），客户端可见内部异常类型。 | 暂不处理：extraction 层的异常消息均为受控文本（不含路径/key），对 MVP 客户反而可读；若未来接入含敏感信息的异常需收敛为固定文案 |
| R-9 | 仅供参考 | `batch_extract` 双模式返回形状不一致：fail-fast 模式的结果项无 `error` 键，容错模式有。 | 已缓解：docstring 明确两种模式的形状；HTTP 消费者永远走容错模式（routes.py 固定传参），契约稳定；CLI（Phase 5）按需自选 |

### 结论

无必须修复项，Phase 4 通过 review。D-007 随本次契约落地闭环，新增 D-008 记录 API 契约决策。

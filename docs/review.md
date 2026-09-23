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

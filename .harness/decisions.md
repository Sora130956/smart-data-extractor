# 决策记录（ADR）

> 记录"为什么选 A 不选 B"。每做一个影响后续开发的技术/设计决策，追加一条。

## 格式

每条决策包含：编号、日期、状态、标题、背景、决策、影响、理由（为什么不选备选方案）。

## 决策列表

---

## D-001：输入格式选择（只做纯文本）

- **日期**：2026-09-22
- **状态**：已接受
- **背景**：
  - Portfolio目标是7天交付可展示的MVP
  - 从Upwork职位样本分析，20个数据提取职位中：纯文本需求16个（80%），PDF需求2个（10%），Excel需求2个（10%）
  - Line 2的$10职位完全匹配纯文本提取场景
- **决策**：Day 1-7 MVP只支持纯文本输入，PDF/Excel/Email解析延后到Week 2+按客户需求扩展
- **理由**：
  - ✅ 纯文本覆盖80%市场需求
  - ✅ 技术栈简单，无需OCR/文档解析库
  - ✅ 7天能做完整，降低交付风险
  - ✅ 更容易破零（$10-100的单子多是纯文本）
  - ✅ 边际扩展成本低（接单后2-3天加PDF支持）
  - ❌ PDF解析需要PyPDF2/pdfplumber/Textract，调试需2-3天
  - ❌ Excel读取虽然简单（pandas），但增加依赖和测试复杂度
  - ❌ 邮件MIME解析需要email.parser，HTML清理也有边界情况
- **影响**：
  - README和Demo视频要说明"支持纯文本，可按需扩展PDF/Excel"
  - Proposal模板针对纯文本场景优化
  - 接到PDF需求时预留2-3天开发时间

---

## D-002：预制场景选择

- **日期**：2026-09-22
- **状态**：已接受
- **背景**：
  - 用户希望工具开箱即用，不是每个客户都会写JSON schema
  - Upwork数据提取需求中高频场景：联系方式、发票、客户信息、简历
- **决策**：预制3个场景：Contact（联系方式）、Invoice（发票数据）、Lead（潜在客户信息）
- **理由**：
  - Contact：Upwork需求量最高（⭐⭐⭐⭐⭐），从邮件/聊天提取客户信息
  - Invoice：需求量高（⭐⭐⭐⭐），财务自动化场景
  - Lead：销售场景（⭐⭐⭐⭐），从询价邮件提取销售线索
  - ❌ Resume：需求量中等但竞争激烈，延后
  - ❌ Event/Meeting：需求量较低（⭐⭐⭐），优先级低
- **影响**：
  - 需要为3个场景定义Pydantic模型
  - CLI用法：`python extract.py --preset contact --input data.txt`
  - API用法：`POST /extract {"preset": "contact", "text": "..."}`

---

## D-003：核心功能优先级

- **日期**：2026-09-22
- **状态**：已接受
- **背景**：7天时间有限，需要在"展示能力"和"可交付"之间平衡
- **决策**：
  - **必做**：纯文本输入、3预制场景、自定义schema、Confidence Score、Validation Rules、Cost Tracking、Fallback Handling、批量处理、CLI+API、测试、部署、Demo视频
  - **不做**：Web UI、多模型自动切换、Webhook集成、图片OCR
- **理由**：
  - Confidence Score：打消客户对LLM瞎编的顾虑（高ROI功能）
  - Validation Rules：防止格式错误数据（高ROI功能）
  - Cost Tracking：展示透明度建立信任
  - Fallback Handling：真实场景必需（输入质量参差不齐）
  - ❌ Web UI：API足够，客户可以自己集成，加UI要多花2-3天
  - ❌ 多模型切换：首单用gpt-4o-mini即可，客户要求时再加
- **影响**：
  - 每个提取返回：`{data, confidence, cost_usd, tokens_used}`
  - 批量提取要支持并发控制（Semaphore）避免rate limit

---

## 待决策

（未来技术选型决策追加在此）

---

## D-004：锁定 pydantic-ai 2.46 API 写法

- **日期**：2026-09-22
- **状态**：已接受
- **背景**：
  - 原始计划文档 `plan/2026-09-18-portfolio-driven-data-extraction-plan.md` 里的代码片段基于旧版 pydantic-ai 写法
  - 实际 `uv add pydantic-ai` 安装到 2.46.0，存在破坏性 API 变更
  - 若照抄计划文档代码，实现阶段会大量报错返工
- **决策**：
  - 以 `spike_feasibility.py` 作为本项目唯一的 pydantic-ai API 参考基准
  - 明确 4 处变更：`output_type`（非 `result_type`）、`result.output`（非 `result.data`）、`result.usage` 是属性（非方法）、成本用内置 `genai_prices.calc_price(usage, model_ref)`（不自建价格表）
  - 单测统一用 `pydantic_ai.models.test.TestModel`，respx 仅在需要拦截真实 HTTP 时备用
- **理由（为什么不选备选方案）**：
  - 备选 A：pin 到旧版本以匹配计划文档 → 放弃。旧版无内置价格表和 TestModel，Cost Tracking 和离线测试都要自己实现，反而更费时间
  - 备选 B：边写边试错 → 放弃。违反"验证先于完成"，且 API 错误会分散在多个模块里难以定位
- **影响**：
  - Confidence Score 实现方式确定：把 `xxx_confidence: float = Field(ge=0.0, le=1.0)` 作为 schema 字段让 LLM 自评，不读 logprobs
  - 成本追踪无需自建价格表，直接复用 genai-prices
  - 所有单测零 API 成本，可进 CI

---

## D-005：提取层用模型注入做离线测试

- **日期**：2026-09-23
- **状态**：已接受
- **背景**：
  - `extract_data` 需要打 OpenAI 才能跑，但 workspace 测试纪律要求"测试不得打真实网络"且"禁止 mock 被测对象本身"
  - `genai_prices.calc_price` 返回 `Decimal`，与返回值契约（JSON 可序列化 float）不符
- **决策**：
  - `extract_data(text, preset, schema_dict, *, model=None, model_ref=None)`：`model` 为依赖注入缝——测试传 `TestModel()`，生产传 None 时回落到 `settings.model`
  - 注入非字符串 model 且未给 `model_ref` 时，成本按 `DEFAULT_MODEL_REF = "gpt-4o-mini"` 计价（与默认生产模型一致，已在代码注释和 review R-1 中记录漂移风险）
  - `calculate_cost` 内部 `float(...)` 转换后返回
- **理由（为什么不选备选方案）**：
  - 备选 A：respx 拦截真实 HTTP → 放弃。TestModel 在 agent 层即可离线产出结构化输出+usage，无需走到 HTTP 层，更简单且 D-004 已定调"单测统一用 TestModel"
  - 备选 B：测试里 monkeypatch 环境变量伪造 API key 再跑真实 model → 放弃。仍然打网络，违反纪律
  - 备选 C：cost 直接返回 Decimal → 放弃。FastAPI/JSON 序列化 Decimal 行为不一致（可能序列化为字符串），破坏 API 响应契约
- **影响**：
  - 单测全程无需 `OPENAI_API_KEY`（已验证：删环境变量后 98/98 通过）
  - 未来 CLI/API 入口调用 `extract_data` 时不传 `model` 即可，生产路径不受影响

---

## D-006：并发限流、成本来源与 Agent 缓存（用户四问驱动）

- **日期**：2026-09-23
- **状态**：已接受
- **背景**：
  - 用户 review Phase 2 代码时提出四问，核实后发现三处可改进：
    1. pydantic-ai 2.46 的 `RunUsage.cost` 由框架自动按 genai_prices 填充（无价目模型才为 None），自写 calculate_cost 属重复劳动
    2. `Agent(max_concurrency=...)` 支持传入可跨 agent 共享的 `ConcurrencyLimiter`，比手写 Semaphore 更优
    3. 字符串 model 构造是 eager 的（立即建 provider + AsyncOpenAI client），每次调用新建 Agent 会丢失连接池
- **决策**：
  - 成本：`_resolve_cost` 优先用 `usage.cost`，`calculate_cost` 仅作无价目模型（如 TestModel）的 fallback
  - 限流：`shared_concurrency_limiter()`（lru_cache 单例，`ConcurrencyLimiter(settings.max_concurrency)`）注入所有生产 Agent；Phase 3 batch.py 不再手写 Semaphore
  - 缓存：`get_preset_agent(preset_name, model_ref)` 用 `functools.lru_cache` 缓存生产 Agent（key 天然有界：3 预设 × 少数模型）；注入模型与动态 schema 路径不缓存
  - 顺带：所有提取 Agent 统一 `ModelSettings(temperature=0)`（确定性输出）
- **理由（为什么不选备选方案）**：
  - 备选 A：保留手写 Semaphore → 放弃。每次新建 Agent 时各 Semaphore/limiter 互不感知，等于没有全局限流；共享 limiter 才是全局语义且带 observability
  - 备选 B：自维护 agent 缓存 dict → 放弃。lru_cache 是标准库，key 有界无需淘汰策略，不引第三方依赖
  - 备选 C：动态 schema 也缓存 → 放弃。用户 schema 无界，缓存即内存泄漏
- **影响**：
  - Phase 3 设计变更：batch.py 只做 `asyncio.gather`，限流由 agent 层承担
  - `DEFAULT_MODEL_REF` 仅在 fallback 路径生效（review R-1 已标记缓解）
  - 测试基建新增：`fake_openai_env` fixture（假 key + 三层 cache_clear），支撑生产路径的离线构建测试

---

## D-007：batch 层失败语义——保持 fail-fast，per-item 容错留给 API 层

- **日期**：2026-09-23
- **状态**：已接受
- **来源**：Phase 3 review（R-4）
- **背景**：
  - `batch_extract` 用裸 `asyncio.gather`：任一条文本失败（生产中的 API 抖动、限流 429 等）会让整批抛异常，调用方拿不到任何部分结果
  - 且 gather 传播首个异常时不取消其余任务，后台任务继续消耗 token
  - 备选方案 `return_exceptions=True` 需要每条结果带 error 字段，属于返回契约变更
- **决策**：batch 层维持 fail-fast；per-item 容错（返回契约里加 error 字段、部分成功的聚合口径）推迟到 Phase 4 定义 `/batch_extract` API 响应契约时统一设计
- **理由（为什么不选备选方案）**：
  - 备选 A：现在就在 batch 层加 `return_exceptions=True` → 放弃。返回契约（结果项可能是异常对象）应由传输层需求驱动，batch 层单方面决定会导致 Phase 4 返工；且 MVP 的 CLI/API 调用方尚不存在，容错口径无实际约束
  - 备选 B：加 `asyncio.shield` 或手动取消剩余任务 → 放弃。增加复杂度却不解决契约问题；fail-fast 下后台任务消耗少量 token 在 MVP 预算内可接受（单条 < $0.0005）
- **影响**：
  - Phase 4 设计 `/batch_extract` 响应 DTO 时必须回答：单条失败是整批 500 还是返回部分结果 + error 字段
  - 若选部分容错，`batch_extract` 需加参数（如 `return_exceptions: bool = False`），保持默认行为向后兼容

---

## D-008：API 契约——批量部分容错 + instructions 双端点暴露 + 错误分层

- **日期**：2026-09-24
- **状态**：已接受
- **来源**：Phase 4 设计对齐（D-007 遗留问题 + plan 的 DTO 未覆盖 extract_data 已有的 instructions 参数，经用户拍板）
- **背景**：
  - D-007 把批量失败语义推迟到 Phase 4 定义 API 响应契约时回答
  - Day 2 应用户要求给 `extract_data` 加了 `instructions`（客户自定义说明），但 plan 阶段 4 的 DTO 设计（`{text, preset?, schema?}`）早于该特性
- **决策**：
  1. `/batch_extract` 采用**部分容错**：HTTP 200，`results` 每项统一形状 `{data, tokens_used, cost_usd, error}`，失败条 `data=None` + `error="ExcType: msg"` + 用量/成本归零，聚合只计成功条，响应新增 `succeeded` / `failed` 计数；`batch_extract` 加 `return_exceptions: bool = False`（默认 fail-fast 向后兼容），API 层固定传 True
  2. `instructions` 在 `/extract` 和 `/batch_extract` 都暴露为可选字段；`batch_extract` 同步加透传参数（R-5 注明的向后兼容扩展）
  3. 错误分层：请求形状错误（both/neither、未知 preset、schema 字段缺 `type` 键）在 DTO `model_validator` 收口 → 422；提取层业务 `ValueError` → 400；其余异常 → 500
- **理由（为什么不选备选方案）**：
  - 备选 A：批量 fail-fast 整批 500 → 放弃。不符合 D-003 的 Fallback Handling 定位；客户传 100 条不该因 1 条 API 抖动全丢
  - 备选 B：未知 preset 也由路由捕获 ValueError 返回 400 → 放弃。preset 成员性是请求形状问题，DTO 校验（422，FastAPI/pydantic 标准语义）比路由 try/except 更薄更一致
  - 备选 C：DTO 字段直接命名 `schema` → 放弃。会遮蔽 `BaseModel.schema`，用 `schema_` + `Field(alias="schema")` 保持外部契约不变
- **影响**：
  - `schemas.py` 引入 `api → presets` 依赖（单向，合规）
  - DTO 的 schema 形状校验与 `models.dynamic` 的 `{"fields": ...}` 双形状约定保持一致
  - HTTP 消费者永远走容错模式，契约稳定；CLI（Phase 5）作为库调用方可自选语义
  - `batch_extract` 双模式返回形状差异已登记为 R-9

---

## D-009：CLI 契约——容错批量 + 退出码分层 + 数据/诊断流分离

- **日期**：2026-09-24
- **状态**：已接受
- **来源**：Phase 5 实现（D-008 遗留的"CLI 自选语义"问题 + plan 5.1 未定义退出码与输出流）
- **背景**：
  - D-008 授权 CLI 作为库调用方自选 batch 失败语义，但未定选哪种
  - plan 5.1 只定义了命令形状（extract/batch 的参数），未定义退出码、stdout/stderr 分工、部分失败时的行为
  - CLI 的典型消费方式是脚本管道（`smart-data-extractor batch ... | jq`），输出流纪律直接决定可用性
- **决策**：
  1. `batch` 固定走容错模式（`return_exceptions=True`）：部分结果照常写出（`--output` 文件或 stdout），任一条失败 → exit 1
  2. 退出码分层：0 成功（批量=全部条目成功）；1 业务错误（未知 preset、schema 形状错误）或批量部分失败；2 用法错误（--text/--input-file 与 --preset/--schema 的组合冲突、空 JSONL、schema 非法 JSON/非对象）——与 API 的 200/400/422 分层一一对应
  3. stdout 只放数据（结果 JSON）；stderr 放诊断（批量汇总行、错误消息）——保证管道可解析
  4. 入口名沿用 `smart-data-extractor`（对齐 pyproject 现有占位），指向 `smart_data_extractor.cli:app`
- **理由（为什么不选备选方案）**：
  - 备选 A：batch 走 fail-fast（默认模式）→ 放弃。一条 API 抖动丢整批结果，违背 D-003 Fallback Handling 定位；API 已选容错，CLI 双标无理由
  - 备选 B：汇总与 JSON 同打 stdout → 放弃。`| jq` 立即解析失败；数据/诊断分流是 CLI 惯例（curl -s / wget -q 同理）
  - 备选 C：脚本名用 plan 5.1 写的 `extractor` → 放弃。与项目名/镜像名脱节，`smart-data-extractor` 自解释且占位已存在
- **影响**：
  - Phase 8 README/Demo 按 0/1/2 退出码与流分工展示用法
  - plan 5.1 的 `extractor` 命令名与实际 `smart-data-extractor` 存在文档偏差，以本决策为准
  - R-9（batch 双模式形状差异）对 CLI 无影响：CLI 永远走容错模式，结果项恒有 `error` 键
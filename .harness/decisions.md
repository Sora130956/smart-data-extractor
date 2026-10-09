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

## D-010：preset description 双语化——按 UI 语言取列 + 互为回退

- **日期**：2026-10-07
- **状态**：已接受
- **来源**：DB 化改造（7fe44e4..bbef518）后的 i18n 缺口：中文界面 Schema 编辑器"描述"显示英文
- **背景**：
  - `schema_fields.description` 单列存英文，中文界面与发往 LLM 的字段描述无法本地化
  - 用户自定义字段（/schema/resolve）本来就只填一种语言，需保持行为一致
- **决策**：
  1. `SchemaFieldRow.description` 拆为 `description_zh` + `description_en` 两列（均 nullable），seed 22 字段补全中文
  2. 取值规则：`lang.startswith("zh")` 优先 zh 回退 en，否则优先 en 回退 zh——单语言自定义字段与 preset 走同一规则
  3. `lang` 从前端 `i18n.resolvedLanguage` 经 `/extract`、`/batch_extract` 请求体（可选 `lang: str | None`）透传至 `extract_data` → `get_preset`；`get_preset_agent` 的 lru_cache 键加入 lang（两种语言各一份缓存）
  4. `/presets/{name}/schema` 响应的 `PresetFieldInfo.description` 拆为 `description_zh`/`description_en`，前端 `usePresetSchema` 按语言选列（含回退），描述随 queryKey 中的 lang 自动刷新
  5. `/schema/resolve` 的 `SchemaFieldInput.description` 保持单语言不变
- **理由（为什么不选备选方案）**：
  - 备选 A：请求时由后端翻译 → 放弃。引入额外 LLM 调用与不确定性，seed 数据本就可静态双语
  - 备选 B：description 存 JSON `{"zh":..,"en":..}` 单列 → 放弃。SQLite 查询/约束无法触及内部键，与 display_name_zh/en 双列模式不一致
  - 备选 C：只改前端显示、LLM 仍收英文 → 放弃。需求明确要求发给 LLM 的描述也按界面语言
- **影响**：
  - dev 库 `smart_data_extractor.db` 需删除重建（create_all 不做列迁移）
  - CLI 未暴露 lang（保持英文默认），后续如需再加
  - commits：a592b66 / fa9dd03 / 1b5732b / 5129618 / fe4a846
## D-011：GLM OCR 响应缺 `object` 字段的兼容——GlmChatModel 回填 + http2 MockTransport 测试缝

- **日期**：2026-10-08
- **状态**：已接受
- **来源**：真实 GLM OCR 调用逐页失败：`UnexpectedModelBehavior: Invalid response from openai chat completions endpoint ... Input should be 'chat.completion' [literal_error, input_value=None]`
- **背景**：
  - 智谱 open.bigmodel.cn 的"OpenAI 兼容"端点响应不含 `"object": "chat.completion"` 字段
  - openai SDK 3.16.2 构造响应对象不做校验（`object` 保持 None 透传）；pydantic-ai 2.46 的 `_validate_completion` 严格复校验 `Literal['chat.completion']`（仅放宽过 `service_tier`）→ 整个响应被拒
  - 另发现：respx 0.23.1 只 patch httpx，而 openai 3.16.2 走 httpx2 传输层 → respx 对该调用链拦不住（会真网外呼）
- **决策**：
  1. `GlmChatModel(OpenAIChatModel)` 覆写 pydantic-ai 提供的 `_validate_completion` 扩展钩子：`response.object is None` 时回填 `'chat.completion'` 再走父类校验
  2. `build_glm_model(*, http_client=None)` 增加注入缝；`build_glm_model` 改返回 `GlmChatModel`
  3. 回归测试 `test_parse_pdf_tolerates_glm_response_missing_object_field`：`httpx2.MockTransport` 假端点返回无 `object` 的 GLM 形状响应，走完整 `parse_pdf` 链路（SDK 解析 → pydantic-ai 校验 → 文本/usage 断言），零真实网络
- **理由（为什么不选备选方案）**：
  - 备选 A：respx 在 HTTP 层拦截 → 放弃。respx 不支持 httpx2，实测漏拦导致真网外呼（ConnectError）
  - 备选 B：等 pydantic-ai 上游放宽 `object` → 放弃。2.46.0 无此放宽亦无时间表，OCR 当前就坏
  - 备选 C：只做单测直接构造 ChatCompletion → 放弃。绕过了 openai SDK 实际解析路径（`object=None` 正是 SDK 不校验产生的），复现不忠实
- **影响**：
  - `build_glm_model` 返回类型注解不变（GlmChatModel is-a OpenAIChatModel，既有 isinstance 断言不受影响）
  - pydantic-ai 未来若放宽 `object`，`_validate_completion` 覆写自动变空操作，无兼容负担
  - 验证：测试先红（精确复现线上报错）后绿；全量 196 passed / 2 skipped

## D-012：PDF 解析方式设置——header 设置面板 + 按页拆分来源

- **日期**：2026-10-08
- **状态**：已接受
- **来源**：用户需求——一个 PDF 文件可能包含多条数据记录，整份拼接只能抽出一条
- **背景**：
  - `parse_pdf` 本就逐页 OCR 后拼接为单一 `text`，多记录 PDF 的信息在提交前即被合并
  - `batch_extract` 下游天然支持多来源独立提取，缺的只是"每页一条来源"的入口
  - 用户先要求在 PasteTextInput 内放开关，看过交互预览后改为：header「设置」按钮 + 设置 modal（可扩展模型选择等后续配置）
- **决策**：
  1. 后端：`parse_pdf` 返回增加 `pages: list[str | None]`——与 PDF 页数等长、按原始页序对齐、失败页为 `None`（`text` 仍为成功页拼接，向后兼容）；`ParsePdfResponse` 透传
  2. 前端 schema：`parsePdfResponseSchema` 加 `pages: z.array(z.string().nullable())`（网络边界强校验契约漂移）
  3. 前端 store：`useUiStore` 加 `pdfSplitMode: 'whole' | 'pages'`，localStorage `sde.pdfSplitMode` 持久化，默认 `whole`；非法存储值回退 `whole`
  4. 前端 UI：Header 加「⚙ 设置」按钮 → `SettingsModal`（overlay 点击/Esc/✕ 三路关闭，aria dialog）；「文档解析」分组含 segmented 开关（aria-pressed，样式对齐 LanguageToggle）+ 随模式切换的 hint；「模型」分组占位（GLM-4.6V 默认 + 即将支持徽章，后续接模型自选）
  5. 前端拆分：pages 模式下 `result.pages.forEach`，跳过 `null` 页，来源命名 `文件名 · P{原页码}`（index+1，失败页留空号不重排）；whole 模式行为不变
- **理由（为什么不选备选方案）**：
  - 备选 A：后端按页拆分逐页返回多次 → 放弃。`parse_pdf` 一次调用已拿到全部页文本，前端拆零成本；后端拆需改请求模型（页码参数）徒增往返
  - 备选 B：开关放 PasteTextInput 内 → 放弃（用户看预览后拍板）。上传区职责单一；设置项会持续增多（模型自选等），收口到 header 设置面板
  - 备选 C：`pages` 只返回成功页（压缩数组）→ 放弃。丢失页码对齐，前端需靠 `pages_failed` 反推页码，None 占位更直白
- **影响**：
  - API 响应新增必填字段 `pages`：旧后端 + 新前端会 400（zod 拒绝），前后端需同步部署；测试环境 fake 已同步补齐
  - 测试注意：zustand store 模块级单例，跨测试用例须显式 `useUiStore.setState({ pdfSplitMode })` 防状态泄漏（本次 spinner 测试即因此先红）
  - 验证：后端 196 passed / 2 skipped；前端 116 passed（17 files）+ `tsc --noEmit` 0 错误

## D-013：图片 OCR 上传——独立 `/parse_image` 端点 + 共享 OCR 核心，不走分页拆分

- **日期**：2026-10-08
- **状态**：已接受
- **来源**：用户需求——PasteTextInput 的拖拽区支持图片上传，逻辑与 PDF 类似但不需要分页拆分
- **背景**：
  - `parse_pdf` 的本质是"PDF 页面渲染为图片 → 逐图 GLM 视觉 OCR → 拼接"；图片文件可以跳过渲染步骤，直接作为一张"页"送入同一套 OCR 循环
  - D-012 的 `pdfSplitMode`（whole/pages）是因为一份 PDF 可能含多条记录；单张图片天然只有一条记录，不存在拆分的意义
  - 可选方案是把 `/parse_pdf` 泛化成通用 `/parse_document`（按 content-type 分支），或新增独立 `/parse_image`；经向用户确认，选择后者以保持现有 `/parse_pdf` 契约零变更
- **决策**：
  1. 后端 `extraction/ocr.py` 重构：抽出私有 `_ocr_images(images: list[bytes], *, media_type, model, model_ref) -> dict`（逐图 OCR + 成功/失败聚合 + token/cost 统计，原在 `parse_pdf` 内联）与 `_resolve_model(model, model_ref)`（生产默认 GLM 模型构建路径）；`_ocr_page` 增加 `media_type: str = "image/png"` 参数（原写死 png）
  2. 新增公开函数 `parse_image(image_bytes, *, media_type="image/png", model=None, model_ref=None) -> dict`：不经过 `pdf_to_images` 渲染，直接把原始字节当作唯一一页送入 `_ocr_images`，返回形状与 `parse_pdf` 完全一致（`text/pages/pages_failed/tokens_used/cost_usd`，`pages` 恒为单元素列表）
  3. 路由层新增独立 `POST /parse_image`（非合并进 `/parse_pdf`）：DI 缝 `get_parse_image_fn`，content-type 白名单 `{image/png, image/jpeg, image/jpg, image/bmp}`（智谱 GLM 视觉官方支持格式），非法类型 422；复用既有 `ParsePdfResponse` 响应模型（形状相同，无需新建 DTO）
  4. 前端：`parseImageResponseSchema = parsePdfResponseSchema`（复用）；`client.parseImage` 对应新端点；`PasteTextInput.stage()` 新增 `imageFiles` 分支（扩展名白名单 png/jpg/jpeg/bmp），**始终** `onAdd(file.name, result.text)`，不读取 `pdfSplitMode`、不做按页判断
- **理由（为什么不选备选方案）**：
  - 备选 A：合并为通用 `/parse_document`（按 content-type 内部分支渲染或不渲染）→ 放弃（用户拍板）。会改动已上线的 `/parse_pdf` 契约和前端调用点，向后兼容收益不足以抵消改动面；两个端点各自职责单一，路由层保持薄
  - 备选 B：图片也套用 `pdfSplitMode` 拆分逻辑（恒为 1 页，等效 whole）→ 放弃。徒增前端分支判断成本，语义上图片从不存在"按页拆分"的选项，直接硬编码整图行为更直白
  - 备选 C：`_ocr_page` 不加 `media_type` 参数，图片单独写一套 OCR 循环 → 放弃。与 `parse_pdf` 的失败容错、token/cost 统计逻辑完全重复，违反"避免重复代码"原则
- **影响**：
  - `/parse_pdf` 端点与现有契约零变更，无需前端已有调用点回归
  - `ParsePdfResponse` 复用到两个端点语义上略怪（命名含 Pdf），但避免重复 DTO；若后续图片/PDF 契约出现分歧需拆分
  - 验证：后端新增测试（`test_ocr.py` 3 个 + `test_routes.py` 4 个），全量 203 passed / 2 skipped；前端新增测试（`client.test.ts` 2 个 + `PasteTextInput.test.tsx` 2 个），全量 121 passed（17 files）+ `tsc -b --noEmit` 0 错误 + `vite build` 成功

## D-014：Excel 导出——前端 ExcelJS 动态导入 + 纯数据模型层 + 两 sheet（结果/字段置信度）

- **日期**：2026-10-09
- **状态**：已接受
- **来源**：用户需求——结果区两处「导出 Excel（即将支持）」禁用按钮（ResultsHeader 批量 / ResultDetailModal 单条）实装
- **背景**：
  - 提取结果是纯前端累积状态（跨批次前插合并 + localStorage 历史），后端 `/batch_extract` 无状态存储；生成 Excel 若走后端需把全部结果 POST 回去再下载文件，多一次往返 + payload + 新依赖，无收益
  - 设计两问经用户拍板：①生成位置选「前端 ExcelJS」（备选 SheetJS npm 版停更于 2022、后端 openpyxl 无意义往返）；②sheet 布局选「两 sheet：结果 + 字段置信度」（备选单 sheet 值/置信度交错列数翻倍、置信度括号附值破坏单元格纯数据性）
- **决策**：
  1. `frontend/src/utils/excelExport.ts` 分三层：`buildExportModel(sources, t)` 纯函数（无 DOM、无 exceljs 依赖，产出 `{results, confidence}` 两 sheet 的列/行矩阵）→ `buildWorkbook(model)` 动态 `import('exceljs')` 构建 workbook（表头加粗 + 冻结首行 + 固定列宽）→ `exportToExcel(sources, filename, t)` 写 buffer + Blob 下载（复用 JSON 导出的 a.click 模式）
  2. Sheet「结果」列：来源 | 项 | 状态（按 UI 语言 成功/失败）| 错误 | 字段并集（跨全部结果按首次出现排序，表头用 fieldLabels 首见标签回退裸 key）| 平均置信度 | 成本 (USD)；Sheet「字段置信度」列：来源 | 项 | 字段置信度数值（缺失→空）| 平均置信度；两 sheet 行 1:1 对齐便于交叉核对
  3. 单元格序列化对齐 ResultDetailModal 的 formatFieldValue，但原语保留原生类型（number/boolean 不转字符串，Excel 可直接计算），null→空单元格，纯数组 join(', ')，含对象数组/对象→JSON.stringify
  4. 单条导出复用同一入口：DetailModal 构造 `{...source, results: [result]}` 传入；文件名批量 `extraction-results.xlsx`、单条 `${source.name}-${label}.xlsx`（对齐既有 JSON 导出命名）；按钮态对齐 JSON 导出（批量无结果禁用 / 单条恒可用）；i18n 移除「（即将支持）」并新增 `excel.*` 表头词条（EN/zh）
- **理由（为什么不选备选方案）**：
  - 备选 A：后端 openpyxl 生成 → 放弃。结果数据只在前端，服务端生成需全量回传；后端零改动是本次方案的核心优势
  - 备选 B：SheetJS（npm `xlsx` 0.18.5）→ 放弃。npm 版两年未更新，ExcelJS 维护活跃且类型完备
  - 备选 C：CSV → 放弃。非真 .xlsx，BOM/转义/多 sheet 均不支持，用户明确要 Excel
- **影响**：
  - exceljs 929 kB（gzip 256 kB）经动态导入独立成懒加载 chunk，主 bundle（377 kB）不受影响，点击导出时才加载
  - `t` 以参数注入 util（type-only 引 react-i18next），表头/状态文案跟随 UI 语言；测试用 i18next 单例直取
  - 验证：TDD 先红后绿（util 层 7 用例：字段并集/标签回退/序列化/失败行/置信度表/workbook 集成；组件层 3 用例：mock exportToExcel 断言调用契约）。全量 vitest 144 passed（18 files）、`tsc -b --noEmit` 0 错误、`vite build` 成功且 exceljs 独立 chunk（`exceljs.min-*.js`）


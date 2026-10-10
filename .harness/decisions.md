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


## D-015：智能推断模板命名——AI 生成 schema_name 双语列

- **日期**：2026-10-09
- **状态**：已接受
- **来源**：用户反馈——上传发票走「智能推断 ✨」后，下拉「我的模板」里保存的模板名是「智能推断 10/09 10:45」（前缀+时间戳），看不出这是什么模板
- **决策**：
  1. `/schema/infer` 的 LLM 输出模型 `_InferredSchema` 新增必填 `schema_name`（与输入文本同语言的短名，如中文发票文本→「发票信息」）与 `schema_name_en`（英文名），INFER_INSTRUCTIONS 同步约束（短名、禁止 schema/data 等泛化名），随响应顶层返回
  2. `SchemaResolveResponse` 新增可选 `schema_name`/`schema_name_en`（`/schema/resolve` 不返回，默认 None，契约向后兼容）
  3. 前端 `App.tsx` 保存模板时按 UI 语言优先取 AI 名（zh→schema_name 优先，en→schema_name_en 优先，互为回退），AI 名缺失时回退旧「前缀+时间戳」逻辑
- **理由**：命名信息本就在同一次 LLM 调用的上下文里，随字段推断一并生成零额外成本；双语列沿用 D-010 的语言回退惯例；时间戳回退保证旧后端/极端情况不裸崩
- **影响**：TestModel 的 `custom_output_args` 需补全新增必填字段（3 个既有测试更新）；验证：后端 210 passed / 2 skipped（先红 KeyError 后绿）、前端 vitest 145 passed（18 files）+ `tsc -b --noEmit` 0 错误（先红「找不到 Invoice Info 选项」后绿，含 localStorage 持久化名断言）

## D-016：导出文件名——模板名快照 + 紧凑时间戳

- **日期**：2026-10-09
- **状态**：已接受
- **来源**：用户反馈——单条导出文件名为「Manual Input 1-文本 1」，无法辨识是哪套模板跑出来的结果
- **决策**：
  1. `ExtractionSource` 新增可选 `presetLabel`，提交时随 `fieldLabels` 一起由 App 快照（与历史记录 presetLabel 同思路），经 `BatchExtractInput.presetLabel` → `adaptBatchExtractResponse` 第 5 参落到每个 source 上
  2. 新增纯函数 `utils/exportFilename.ts`：`buildExportFilename(label, ext, now?)` → `模板名-YYYYMMDD-HHmmss.ext`，替换 Windows 非法字符（`\/:*?"<>|`→`_`），空名回退 `export`
  3. 四处导出统一走该函数：批量 `ResultsHeader`（取最新一批 source 的 presetLabel，缺失回退 source.name→'extraction-results'）与单条 `ResultDetailModal`（source.presetLabel，缺失回退 source.name），JSON/Excel 同规则
- **理由**：导出时下拉当前模板可能与结果来源不符（结果跨批次累积），快照到 source 才准确；时间戳取导出时刻本地时间，紧凑格式按文件名排序即按时间排序
- **影响**：旧历史恢复的 source 无 presetLabel，回退 source.name（行为≈旧命名减去条目标签）；验证：先红（6 失败：导入缺失 + 旧文件名断言）后绿，vitest 150 passed（19 files）+ `tsc -b --noEmit` 0 错误
- **补记（同日修复）**：首版实现里智能推断/改 schema 两分支的 presetLabel 误用了历史通用标签 `t('history.customSchema')`（「自定义字段」），导出名成了「自定义字段-时间戳」。修复：新增 `templateName(id)` 助手（保存模板名 → 后端预设本地化名 → id 回退）统一三处取名；智能推断路径直接复用刚保存的 AI 模板名。`history.customSchema` 词条随修复删除（历史面板标签同步受益，显示真实模板名）。复现用例：App.test.tsx 智能推断 → 点「Export All JSON」断言下载名（先红 `Custom Fields-…` 后绿 `Invoice Info-…`），vitest 150 passed + tsc 0 错误

---

## D-017：模板下拉去 optgroup + 预设编辑本地覆盖（presetOverrides）

- **日期**：2026-10-09
- **状态**：已接受
- **来源**：用户反馈——① 下拉里「我的模板」optgroup 区分预设/自定义迷惑，改用「预设：XXX」前缀区分；② 修改预设模板后不保存（只当前会话生效），需要「保存」按钮；③「重置为预设」不应出现在自定义模板上
- **决策**：
  1. ConfigBar：去掉「我的模板」optgroup，预设项加本地化前缀（`config.presetPrefix`，zh「预设：」/ en "Preset: "），自定义模板平铺其后
  2. uiStore 新增 `presetOverrides: Record<presetId, SchemaField[]>`（localStorage `sde.presetOverrides`）+ `savePresetOverride`/`clearPresetOverride`；SchemaEditor 种子改为 `override ?? presetFields`，「保存」把当前字段存为该预设的覆盖并清 modified 标记
  3. SchemaEditor 按钮矩阵：「保存」对预设与自定义模板都显示（自定义模板=updateSavedSchema）；「重置为预设」仅后端预设显示，且「有覆盖未修改」时也保持可点（重置=清覆盖+回后端基线）
  4. App 提交条件扩为 `isSchemaModified || isSavedSchema || hasPresetOverride`——带覆盖的预设必须走 `/schema/resolve` 自定义 schema 路径，否则后端按 preset id 取原 schema 会忽略用户修改（这是「只当前会话生效」问题的根因之一）
- **理由**：覆盖直接挂在预设 id 上（而非另存为自定义模板）才符合「修改这个预设并保存」的心智模型；提交路径必须识别覆盖，否则保存了也会被后端原 schema 顶掉
- **影响**：`config.mySchemas` 词条删除；验证：先红（23 失败）后绿，vitest 174 passed（19 files）+ `tsc -b --noEmit` 0 错误 + `vite build` 成功。顺手修复两处既有问题：`test/setup.ts` 的 `URL.createObjectURL` 条件桩改为无条件（Node 全局存在但对 jsdom File 抛错，导致 PasteTextInput 4 个 F7 用例恒红）；App.test `makeFile` 补第三参 type（F7 用例传 3 参导致 tsc 报错）

---

## D-018：Render 部署方案——单服务（FastAPI 挂载前端构建产物）+ Blueprint 声明式配置

- **日期**：2026-10-09
- **状态**：已接受
- **来源**：Phase 7（Day 6）部署规划；用户确认走免费层快速上线
- **背景**：
  - 前端 `frontend/` 与后端 `src/smart_data_extractor/` 同仓库，开发环境靠 Vite dev server proxy（`/api` 前缀剥离）打通；生产若两个服务分离部署需处理 CORS 与两份 URL 配置
  - Render 免费层按服务计费（每服务独立 spin-down/冷启动），双服务（静态站点 + API）比单服务多一份冷启动与跨域复杂度
  - Render Python Native Runtime 的构建环境本身预装 `node`/`npm`，可以在同一个 Build Command 里完成前端构建
- **决策**：
  1. 单服务部署：FastAPI 用 `StaticFiles(html=True)` 挂载 `frontend/dist`，同源伺服前端产物，无需 CORS（已随 `api/__init__.py` 的 `/api` 前缀兼容修复落地，见 commit `8065802`）
  2. 新增 `render.yaml`（Blueprint）：`runtime: python`、`buildCommand: "uv sync --no-dev && cd frontend && npm install && npm run build"`、`startCommand: "uv run uvicorn smart_data_extractor.api:app --host 0.0.0.0 --port $PORT"`、`healthCheckPath: /health`
  3. 环境变量：`PYTHON_VERSION=3.11`（与既有 `.python-version` 一致）内嵌在 Blueprint；`OPENAI_API_KEY`/`GLM_API_KEY` 用 `sync: false` 声明占位，实际值在 Render 控制台手填（密钥不入库）
  4. `DATABASE_URL` 不在 Blueprint 中覆盖，沿用 `config.py` 默认 SQLite 相对路径；免费层无持久盘，每次部署容器重建会清空 db 文件，`init_db()` 在 `lifespan` 里自动重新 seed 预设模板，用户历史数据存浏览器 localStorage 不受影响（已知取舍，未来若需持久化用户自定义数据再评估 Render Postgres）
- **理由（为什么不选备选方案）**：
  - 备选 A：前端另建 Static Site 服务 + 后端单独 Web Service → 放弃。两个服务两份冷启动、需配置 CORS 并把前端 API base URL 指向后端域名，免费层下用户体验更差（两次冷启动叠加），且当前前端调用已硬编码 `/api/xxx` 相对路径，同源部署零改动
  - 备选 B：Dockerfile 自定义镜像而非 Native Runtime → 放弃。Native Runtime 已预装 Node 工具链，Build Command 一行覆盖 Python+前端构建，无需维护 Dockerfile 的多阶段构建与基础镜像更新
  - 备选 C：Build Command 用 `pip install` 而非 `uv sync` → 放弃。项目锁定 `uv.lock`，`uv sync` 保证与本地开发环境依赖版本一致，Render 原生识别 uv.lock
- **影响**：
  - 首次部署后需在 Render 控制台手填 `OPENAI_API_KEY`（必需）与 `GLM_API_KEY`（OCR 功能可选）
  - 免费层 spin-down（15 分钟无流量后休眠，冷启动约 30-50 秒）与无持久盘的限制已知且接受，Demo/Proposal 材料需提及首次访问可能有冷启动延迟
  - Phase 8 的 README 需补充 Render 部署徽章/链接与环境变量清单说明
- **补记（同日调整：线上主提取模型定档 DeepSeek）**：用户拍板线上沿用本地同款 `MODEL=deepseek:deepseek-chat`（成本趋近于零：约 ¥1-2/百万 token 输出，demo 级用量可忽略），完全免费方案（Gemini 免费层等）不折腾结构化输出兼容性。`render.yaml` envVars 随之调整：新增 `MODEL`（固定值）与 `DEEPSEEK_API_KEY`（`sync: false` 控制台手填，pydantic-ai 的 `deepseek:` 前缀读此 key）；`OPENAI_API_KEY` 从 `sync: false` 改为固定占位值 `placeholder-not-used`——`Settings.openai_api_key` 是无默认值的必填字段，缺失会启动即 ValidationError，但 DeepSeek 方案下该 key 不被实际读取，占位即可免手填。`GLM_API_KEY` 维持 `sync: false`（OCR 可选）

---

## D-019：demo 阶段每日用量护栏（单 IP 50 次/天 + 全站 1000 次/天，内存计数）+ /stats 流量可见性

- **日期**：2026-10-09
- **状态**：已接受（**demo 阶段专用，正式宣发前必须替换**）
- **来源**：用户计划把 demo 发布到社交媒体宣传，要求防止 API key 被扫穿、能看到自己网站流量、429 提示对用户友好；限额数字用户拍板（单 IP 50/全站 1000）
- **背景**：
  - 服务无用户体系，唯一无摩擦的访客标识是 IP（Render 代理后的 `X-Forwarded-For` 首段）
  - DeepSeek 成本虽低（单次提取约几厘），但无总量上限时脚本可持续烧 key
  - XFF 可伪造、换 IP 可绕过 → 单 IP 限额挡不住分布式滥用，需要全站总额兜底
  - 用户想看流量但不想引第三方统计（umami/GA 等留作宣发后的升级项）
- **决策**：
  1. `api/quota.py` 的 `DailyQuota`：进程内存计数，双层限额（单 IP 50/天、全站 1000/天，`DAILY_QUOTA_PER_IP`/`DAILY_QUOTA_GLOBAL` 可覆盖，<=0 关闭该层），UTC 日期翻转自动清零，clock 可注入
  2. 挂载点：`/extract`、`/schema/resolve`、`/schema/infer`、`/parse_pdf`、`/parse_image` 走 `enforce_daily_quota` 依赖（每请求 1 单位）；`/batch_extract` 在 handler 里按 `len(texts)` 扣（n 次调 LLM = n 单位），超限在任何 LLM 工作前拒绝
  3. 429 响应 detail 为结构化载荷 `{code: quota_per_ip|quota_global, message, reset_at}`；前端 `client.ts` 解析出 `ApiError.code`，`utils/errors.ts` 映射为 i18n key，提取 banner 与 PDF/图片解析错误两处均显示中英双语友好提示
  4. `GET /stats?token=...`：当日 `global_used`/`unique_ips`/`per_endpoint` 计数；未配置 `ADMIN_STATS_TOKEN` 时 404 隐藏（公开 401 等于自曝端点），配错 token 401，比较用 `hmac.compare_digest`
  5. **代码注释（quota.py 模块 docstring 中英双语）与 commit message 显式标注 DEMO-STAGE**，宣发前替换为按用户配额/持久化限流
- **理由（为什么不选备选方案）**：
  - 备选 A：慢速限流（每分钟 N 次，slowapi）→ 放弃。目标是封每日预算上限，不是匀速；且 slowapi 引入依赖解决不了"每天最多花多少钱"
  - 备选 B：SQLite 持久化计数 → 放弃。Render 免费层每次部署重建磁盘，持久化收益趋近于零；内存计数重启清零的代价只是"攻击者多薅一轮"，可接受
  - 备选 C：前端匿名 ID（localStorage UUID）→ 放弃。清缓存即绕过，绕过成本与换 IP 相同，但多一套前端协议
  - 备选 D：umami/GA 统计流量 → 留作宣发后升级项。/stats 零依赖零成本先解决"看得见"，后续要 PV/UV/地域分布再引第三方
- **影响**：
  - 单进程内存计数：多 worker 部署会各自计数（当前 Render 免费层单 worker，不受影响）
  - 同一出口 IP（公司/校园 NAT）共享单 IP 限额，正常试用 50 次/天够用
  - 计数在部署/重启后清零，/stats 数字是"本次部署以来"的当日用量
  - 验证：后端 226 passed / 2 skipped（新增 14 测试，含突变自证——禁用 per-IP 检查后 4 测试变红）；前端 184 passed（串行全量）+ tsc 0 错误。`excelExport.test.ts` 在并发满载下偶发超时（单独跑通过，与本决策无关，机器负载问题待观察）

## D-020：复核字段保留原始提取值（originalData 快照）+ 导出对比

- **日期**：2026-10-10
- **状态**：已接受
- **来源**：GitHub Issue #1（Sora130956/smart-data-extractor）——"复核字段时，需要保留原始字段值。导出的JSON和Excel中也要体现这一点，要能够对比原始提取值和复核后的值"
- **背景**：
  - F8 复核流的三处写入点（App `applyEdit`、historyStore `updateResultField`）都用 spread 直接覆盖 `result.data[fieldKey]`，原始提取值在内存与 localStorage 中均无处保存
  - 导出 JSON（单条/全部/剪贴板/Raw JSON 面板）序列化的是覆盖后的 `data`，无法对比 LLM 答案与人工修正
  - Excel `buildExportModel` 只读 `data`，无任何"已复核"标记或原始值列
- **决策**：
  1. `ExtractionResult` 新增 `originalData?: Record<string, unknown>`：仅在字段**首次**被编辑时快照旧值（re-edit 保留首快照，`hasOwnProperty` 判重）；未编辑字段无条目（其原始值就是 `data`）
  2. 快照逻辑收敛为纯函数 `utils/review.ts#applyFieldEdit(result, fieldKey, newValue)`，App（屏上 state + 打开中的 modal）与 historyStore（localStorage 持久化镜像）共用，保证两处快照语义一致；data 为 null 时快照 null（字段原本不存在也算"原始值为空"）
  3. JSON 导出零改动自动携带（序列化整个 result/source，`data`=复核后 + `originalData`=原始 + `reviewedFields`=标记）
  4. Excel results sheet：字段在**任意行**被复核过 → 紧随其后插入「{字段名}（原始）/ (Original)」伴随列（i18n `excel.originalColumn` 插值）；行值仅在该行该字段已复核时填 `originalData` 快照，否则留空；confidence sheet 布局不受影响；无任何复核时保持原布局（向后兼容）
  5. 详情弹窗：已复核且有快照的字段在当前值下方以弱化小字显示「原始值 Acme Corp / Original value Acme Corp」（i18n `resultDetail.originalValue`）
- **理由（为什么不选备选方案）**：
  - 备选 A：始终全量快照 `originalData = data`（提取完成时就复制一份）→ 放弃。多占内存/存储，且绝大多数字段从未被复核；按需快照让"originalData 有 key"本身就等于"被人工改过"
  - 备选 B：Excel 加"已复核"布尔列 → 不够。Issue 明确要求"对比原始提取值和复核后的值"，布尔标记不提供对比内容；伴随列让两值并排
  - 备选 C：在 reviewedFields 里存 `{ [key]: '原值' }`（布尔改值）→ 放弃。破坏既有布尔语义，localStorage 里旧数据不兼容
- **影响**：
  - 旧 localStorage 数据（无 originalData）兼容：无快照则弹窗不显示原始值行、Excel 该行原始列为空，行为退化合理
  - `applyFieldEdit` 沿用既有"作用于 source 下全部 results"的行为（与修复前一致，多结果来源属边缘场景，不在本 issue 范围）
  - 验证：TDD 先红（5 失败）后绿；前端 197 passed（21 files，串行）+ tsc 0 错误 + build 成功（exceljs 懒加载 chunk 不变）；突变自证（快照值改成 newValue 后 7 测试变红再还原）；浏览器端到端实测（发票预设提取 → 编辑供应商 → 弹窗显示「Acme Corporation Ltd / 原始值 Acme Corp / 已复核」、localStorage 与导出 JSON 均含 originalData、导出 Excel 无报错）

## D-021：字段级最低置信度阈值（SchemaField.minConfidence + 提交时快照 reviewThresholds）

- **日期**：2026-10-10
- **状态**：已接受
- **来源**：GitHub Issue #2（Sora130956/smart-data-extractor）——"每个字段需要支持用户自己配置最低置信度。任一字段低于配置的最低置信度，则触发需要人工复核"（用户拍板：配置入口随字段编辑，放 SchemaEditor）
- **背景**：
  - `needsReview` 原逻辑只有两条：均值 < 0.70 或任一字段 < 0.70（全局一刀切），无法表达"发票号必须 0.99、备注 0.5 就够"的字段间差异
  - 阈值属 schema 配置（随模板保存/预设覆盖持久化），但复核判定属结果消费端（筛选计数、详情警告），二者生命周期不同
- **决策**：
  1. 阈值挂 `SchemaField.minConfidence?: number | null`（纯前端字段，不发给后端）：SchemaEditor 类型/名称/描述之间新增「最低置信度」number 列（`parseMinConfidence`：空→null、clamp [0,1]、垃圾→null，placeholder 显示默认 0.70）；随 savedSchemas/presetOverrides 持久化，无需 uiStore 改动
  2. **提交时快照**（沿用 D-016 presetLabel / fieldLabels 惯例）：`utils/review.ts#buildReviewThresholds(fields, resolved?)` 把编辑器字段映射为按真实字段名 keyed 的 `Record<string, number>`（field_name 优先，缺省回退 display_name 匹配 resolve 回显的 `display_name`），经 `useBatchExtract` → `adaptBatchExtractResponse` 第 7 参挂到 `ExtractionSource.reviewThresholds`——后续 schema 编辑不重判旧批次
  3. 判定收敛 `utils/confidence.ts`：`fieldThreshold(field, thresholds)` 三级回退（字段级 → `CONFIDENCE_LOW`=0.70）；`needsReview` 增加可选 `thresholds` 参数，均值判定不变 + 任一字段低于**其自身**阈值即触发；`belowThresholdFields` 返回 `{field, threshold}` 驱动警告列表
  4. 消费端全走 source 快照：App 筛选计数（high=成功且无需复核）与 ResultDetailModal 警告条均传 `source.reviewThresholds`；警告文案列出各字段及其阈值（i18n `resultDetail.needsReviewWarning`：「需人工复核 — N 个字段低于其最低置信度（Invoice Number (0.99)）」）
- **理由（为什么不选备选方案）**：
  - 备选 A：阈值存 ExtractionSource 级别的全局 map → 配置入口与字段行脱节，用户得在第二处找配置；随字段编辑（用户拍板）所见即所得
  - 备选 B：实时读当前 schema 阈值判旧结果 → 违反 D-016 确立的快照原则，改阈值会追溯翻动已复核批次
  - 备选 C：后端加阈值列 → 判定完全在前端消费端（筛选/警告），后端不发复核指令，纯前端改动最小
- **影响**：
  - 阈值编辑触发 `isSchemaModified` → 走 custom schema 提交路径（多一次 `/schema/resolve`，约 $0.0001/次，v1 接受）
  - smart 智能推断路径首轮字段刚生成、无阈值（回退 0.70），保存模板后第二轮编辑才可配置——已知边界
  - 纯前端改动，后端无涉；旧 localStorage 批次无 `reviewThresholds` → 全部字段回退 0.70，行为与升级前一致
  - 验证：TDD 分层先红后绿（confidence 3 新用例 + review 4 + SchemaEditor 4 + adapters 3 + ResultDetailModal 1）；全量 vitest 215 passed（21 files，并发全量无 flake）+ `tsc -b --noEmit` 0 错误 + `vite build` 成功；突变自证（`fieldThreshold` 回退改 0.9 → 3 测试变红再还原）
- **补记（同日 UI 调整：自由数值输入改预设档位 select）**：用户反馈——「最低置信度」让客户直接填数值门槛过高，改四个预设档位的下拉（用户拍板：严格 0.9 / 较严 0.8 / 默认 0.70 / 宽松 0.5，`<select>` 形式）。实现：`MIN_CONFIDENCE_TIERS`（0.9/0.8/null/0.5，「默认」档存 null 回退 CONFIDENCE_LOW，标签插值 `formatConfidence(CONFIDENCE_LOW)` 与全局默认联动）+ `tierSelectValue`（null 或旧版显式 0.7 → ''）+ `isLegacyConfidence`（旧自由输入遗留的非档位值如 0.85 渲染为独立 option，重选后归位档位）；`parseMinConfidence` clamp 逻辑删除——档位值天然在合法域内；列宽 92px→108px；i18n 删 `minConfidencePlaceholder`、增 `minConfidenceStrict/Moderate/Default/Lenient` 四词条（EN/zh）。数据模型与下游（buildReviewThresholds/fieldThreshold/needsReview）零改动。验证：TDD 先红（5 失败）后绿，SchemaEditor 14 passed；全量 vitest 216 passed（21 files）+ tsc 0 错误 + `vite build` 成功

## D-022：字段级「允许为空」配置（SchemaField.allowEmpty + 提交时快照 allowEmptyFields）

- **日期**：2026-10-10
- **状态**：已接受
- **来源**：GitHub Issue #2 后续（用户拍板："需要再加上：是否允许为空"，commit 引用同一 issue）
- **背景**：
  - 后端 `ConfidenceBase._zero_confidence_for_nulled_fields`（AC-3）把 null 字段的配对 confidence 归零 0.0，因此**现状下任何空值字段都会经阈值判定触发复核**（0.0 < 0.70），可选字段（如备注）缺省时会产生大量无意义复核
  - 用户需要按字段表达"这个字段允许为空"：空值不应触发复核
- **决策**：
  1. **默认「不允许为空」＝保持现状**：`SchemaField.allowEmpty?: boolean`（undefined/false = 不允许；纯前端，不发给后端），不标记任何字段时复核行为与升级前完全一致——零回归
  2. 语义拆分：**空值字段不再参与置信度阈值判定**（归零的 0.0 不是质量信号），改由「允许为空」规则单独判定——`confidence.ts` 新增 `isEmptyValue`（null/undefined/'' 为空，0/false 不是）与 `emptyViolatingFields({data, allowEmpty})`；`belowThresholdFields` 传入 `data` 时排除空值字段；`needsReview` 增加可选 `data`/`allowEmpty` 参数（均值低 / 空值违规 / 阈值违规三条判定）
  3. 豁免仅覆盖空值：标记允许为空的字段**有值时**仍按阈值正常判定（豁免不是免检金牌）
  4. 提交时快照（沿用 D-016/D-021 惯例）：`review.ts` 抽公共 `keyedFields(fields, keep, resolved?)`（field_name 优先、display_name 回退 re-key），`buildReviewThresholds` 重构为其上薄封装（既有 4 用例保护），新增 `buildAllowEmptyFields` → `ExtractionSource.allowEmptyFields?: string[]`（例外清单：仅存显式标记的字段，通常为空数组则省略）；adapters 第 8 参、useBatchExtract/App 透传
  5. UI：SchemaEditor「最低置信度」列后新增「允许为空」两档 select（`不允许`(默认)/`允许`，宽 92px）；ResultDetailModal 警告条拆两段——阈值段（`needsReviewWarning`，既有）+ 空值段（`needsReviewEmptyWarning` 新增：「需人工复核 — N 个字段不允许为空（…）」），归因比旧版把空值字段列成"低于置信度 (0.70)"更准确
- **理由（为什么不选备选方案）**：
  - 备选 A：默认「允许为空」→ 翻转现状，发票号等关键字段 null 将静默通过不触发复核，危险默认
  - 备选 B：把 allowEmpty 发给后端让 LLM 知道字段必填 → 跨 DB/后端改动，且复核判定全在前端消费端（同 D-021 备选 C 的结论），v1 纯前端最小
  - 备选 C：空值字段继续留在 belowThresholdFields 里再在展示层过滤 → 判定与展示耦合两处，不如在单一判定源（confidence.ts）一次分流
- **影响**：
  - 警告文案归因变化（既有行为唯一可见变化）：空值字段从「低于其最低置信度 (0.70)」段落移入「不允许为空」段落，复核触发本身不变
  - 均值判定不豁免：标记允许为空的字段的 0.0 仍计入 avgConfidence，极端配比下仍可能仅因均值触发复核——已知边界，v1 接受（重算均值会让豁免语义雪上加霜）
  - smart 首轮与 D-021 同边界：字段刚生成无用户配置 → 全部不允许为空（= 现状）
  - 验证：TDD 分层先红（5 文件 15 失败）后绿（92 passed）；全量 vitest 235 passed（21 files；excelExport 首轮并发负载超时为既有抖动，重跑/单跑均通过）+ `tsc -b --noEmit` 0 错误 + `vite build` 成功

## D-023：「允许为空」并入最低置信度 0.0 档（撤销独立列）

- **日期**：2026-10-10
- **状态**：已接受（替代 D-022 的 UI 形态；判定内核与快照机制沿用 D-022 不变）
- **来源**：GitHub Issue #2 后续（用户拍板："那这里其实很令人困惑，允许为空，但置信度又有要求。要不取消允许为空这一列，最低置信度加一档允许为空 (0.0)"）
- **背景**：
  - D-022 交付后用户指出 UX 困惑：独立「允许为空」列与「最低置信度」列并排，"允许为空但置信度又有要求"两个旋钮互相打架，客户难以理解
  - 用户洞察：允许为空本质就是阈值 0.0 的特例（后端把 null 字段 confidence 归零 0.0，空值天然从 0.0 线下通过）——可统一为单一心智模型："阈值就是一条线，空值＝0.0，跟线比即可"
- **决策**：
  1. 撤销独立列与独立字段：删 `SchemaField.allowEmpty`、SchemaEditor「允许为空」select 及词条（allowEmpty/allowEmptyNo/allowEmptyYes）
  2. `MIN_CONFIDENCE_TIERS` 增第五档 `{ value: 0, labelKey: schema.minConfidenceEmpty }`（「允许为空 (0.0) / Allow empty (0.0)」），列宽 108px→120px 容纳长标签
  3. `buildAllowEmptyFields` 谓词改 `f.minConfidence === 0`：0.0 档字段同时进两个快照——`reviewThresholds[field]=0`（非空低分 0.5 ≥ 0 通过）+ `allowEmptyFields[]`（空值豁免空值规则）；其余四档默认不允许为空＝现状
  4. **语义收紧为完全免检**（用户设计的自然推论，替代 D-022 的"豁免仅覆盖空值"）：选 0.0 档后该字段非空低置信度也不再触发复核——对备注类完全可选字段更合理；confidence.ts 判定内核、allowEmptyFields 快照、Modal 两段警告归因、App 筛选计数全部沿用 D-022 零改动
  5. 顺手修既有 flake：excelExport buildWorkbook 用例加 `{ timeout: 20000 }`（D-019 记录过的并发满载超时，连续两轮全量红后修掉）
- **理由**：
  - 单一旋钮 < 两个旋钮：档位下拉天然表达"越往下要求越松"，0.0 就是"无要求"，无需第二列解释交互关系
  - 判定内核复用：thresholds/allowEmpty 两快照在 D-022 已就位，本次仅换谓词与 UI，改动面小
- **影响**：
  - 0.0 档字段非空低置信度不再复核（与 D-022 语义差异，接受：完全可选字段本就不设质量门槛）
  - 均值判定仍不豁免（0.0 计入 avgConfidence）——沿用 D-022 已知边界
  - D-022 的 allowEmpty 布尔字段仅存在于未推送的本地 commit，无线上数据，无需迁移
  - 验证：TDD 先红（5 失败：SchemaEditor 五档顺序/无独立列 + review 谓词 3 用例；confidence 层 API 未变新用例直接通过）后绿（5 文件 91 passed）；全量 vitest 234 passed（21 files）+ `tsc -b --noEmit` 0 错误 + `vite build` 成功

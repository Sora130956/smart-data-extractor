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
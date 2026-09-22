# 项目状态（单一进度源）

> 本文件是项目进度的唯一来源。每次会话结束前必须更新本文件。换会话、换模型都靠它接上进度。

## 当前阶段

第 2 步（可行性分析、技术选型）— 已完成，准备进入第 3 步

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

（第 3 步填写后引用 `docs/acceptance.md`）

## 实现计划

（第 4 步填写后引用 `docs/plan.md`）

## 模块清单

（第 4 步后展开）

## 下一步动作

进入第 3 步：产出 `docs/acceptance.md`，写 3-5 条可量化、可脚本检查的验收标准，
与用户评审通过后才能进入第 4 步（实现计划）。**在此之前不写任何实现代码。**

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

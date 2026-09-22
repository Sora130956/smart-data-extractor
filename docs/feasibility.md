# 第 2 步：可行性分析与技术选型

> 状态：已完成
> 核验方式：`uv run python spike_feasibility.py`（无需 API key，离线可跑）

## 结论

**可以做，7 天内能完成 MVP。** 全部 5 项核心能力已用可运行脚本验证通过，无技术阻塞项。

---

## 一、技术能力核验（全部有实际输出证据）

spike 脚本：[spike_feasibility.py](file:///d:/freelancer/workspace/code/portfolio/spike_feasibility.py)

| # | 能力 | MVP 中的用途 | 验证结果 |
|---|------|------------|---------|
| 1 | 静态 schema 结构化输出 | 3 个预制场景（Contact/Invoice/Lead） | ✅ `Agent(model, output_type=Contact)` 返回 Contact 实例 |
| 2 | 运行时动态构造 schema | 用户自定义 JSON schema | ✅ `pydantic.create_model()` 动态建模，字段集与输入 schema 完全一致 |
| 3 | token usage 统计 | Cost Tracking | ✅ `result.usage` → `input_tokens=54, output_tokens=2, requests=1` |
| 4 | 无 API key 离线运行 | 测试可 CI 化、断网可跑 | ✅ `TestModel` 不发网络请求，删除 `OPENAI_API_KEY` 仍能跑通 |
| 5 | 成本计算 | `cost_usd` 字段 | ✅ `genai_prices.calc_price(usage, "gpt-4o-mini")` → 1k in/500 out = **$0.000450** |

### 核验中发现的 API 变更（重要）

实装版本是 **pydantic-ai 2.46.0**，比原计划文档写的旧版 API 有破坏性变更：

| 原计划写法（旧版） | 2.46 实际写法 |
|---|---|
| `Agent(model, result_type=Contact)` | `Agent(model, output_type=Contact)` |
| `result.data` | `result.output` |
| `result.usage()` （方法） | `result.usage` （属性） |
| 需自己维护价格表 | `genai_prices.calc_price(usage, model_ref)` 内置 |

→ 实现阶段必须按 2.46 写法，不能照抄计划文档里的代码片段。

### Confidence Score 的实现方式（已确认可行）

不需要读 logprobs。做法是**把 confidence 作为 schema 的一部分**，让 LLM 自己为每个字段打分：

```python
class Contact(BaseModel):
    name: Optional[str] = None
    name_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    email: Optional[str] = None
    email_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
```

`ge=0.0, le=1.0` 由 Pydantic 强制校验，LLM 给出越界值会触发 pydantic-ai 自动重试。已验证 schema 可正常构造与返回。

---

## 二、成本估算

### 单次调用成本（gpt-4o-mini，实测价格表）

| 场景 | 输入 tokens | 输出 tokens | 单次成本 |
|------|-----------|-----------|---------|
| Contact 提取（短文本 ~200 字） | ~400 | ~150 | **$0.00015** |
| Invoice 提取（中等文本 ~800 字） | ~1200 | ~300 | **$0.00036** |
| Lead 提取（邮件正文 ~500 字） | ~800 | ~200 | **$0.00024** |

基准：gpt-4o-mini 1000 input + 500 output = $0.000450（实测值）

### 开发期总预算

| 用途 | 调用次数 | 成本 |
|------|---------|------|
| 开发调试（真实 API） | ~200 | $0.05 |
| Demo 视频录制 | ~30 | $0.01 |
| Render 部署冒烟测试 | ~50 | $0.02 |
| **合计** | | **< $0.10** |

单测全部走 `TestModel`，**零成本**。

### 对客户的报价支撑

1000 条记录批量提取 ≈ $0.15–0.36 API 成本。可以在 Proposal 里明确写出"1000 records for under $0.50 in API cost"，这是差异化卖点。

---

## 三、技术风险评估

| 风险 | 等级 | 应对措施 |
|------|------|---------|
| **pydantic-ai 2.x API 与计划文档不符** | 🔴 高 | 已在本步骤核验清楚 4 处变更并记录，实现时以 spike 脚本为准 |
| LLM 幻觉编造字段值 | 🟡 中 | Prompt 明确"缺失返回 null"+ `Optional` 类型 + Validation Rules 二次校验 + confidence 低分标记 |
| 批量处理触发 rate limit | 🟡 中 | `asyncio.Semaphore(5)` 限并发 + `tenacity` 指数退避（已随依赖安装） |
| confidence 分数不可靠（LLM 自评偏高） | 🟡 中 | 定位为"参考性指标"，README 写明；格式类字段（email/phone）以 validator 结果为准，不依赖 LLM 自评 |
| Render 免费实例冷启动慢（~50s） | 🟢 低 | `/health` 端点 + Demo 前手动预热；README 注明免费层限制 |
| 自定义 schema 恶意输入（超深嵌套/超多字段） | 🟢 低 | 限制字段数 ≤ 30、嵌套深度 ≤ 2，超限直接 422 |
| OpenAI API 不可用 | 🟢 低 | 依赖已含 anthropic 包，可切 Claude；MVP 不做自动切换（D-003） |

**无红灯阻塞项。** 唯一高风险项（API 变更）已在本步骤消除。

---

## 四、技术选型结论

| 层 | 选型 | 版本（实装） | 理由 |
|----|------|------------|------|
| LLM 框架 | pydantic-ai | 2.46.0 | 结构化输出 + usage 统计 + TestModel 离线测试 + 内置价格表，一个依赖解决四件事 |
| 数据建模 | pydantic | 2.13.5 | pydantic-ai 强依赖；`create_model` 支持动态 schema；`field_validator` 做格式校验 |
| API | fastapi | 0.141.1 | 自动 OpenAPI 文档可直接当 Demo 展示 |
| ASGI | uvicorn | 0.53.0 | FastAPI 标配 |
| CLI | typer | 0.27.2 | 基于 click，类型注解即参数定义，与 pydantic 风格一致 |
| 主力模型 | gpt-4o-mini | — | $0.00045/1.5k tokens，成本最低且结构化输出稳定 |
| 测试 | pytest + pytest-asyncio + respx | 9.1.1 / 1.4.0 / 0.23.1 | `asyncio_mode=auto` 已配；TestModel 为主，respx 备用于 HTTP 层拦截 |
| 部署 | Docker + Render | — | 免费层够用，有公网 URL 可放进 Portfolio |

### 选型放弃项

- **LangChain**：抽象层过厚，结构化输出不如 pydantic-ai 直接，且依赖体积大
- **instructor**：功能与 pydantic-ai 重叠，但 usage/pricing 需自己实现
- **自己封 OpenAI function calling**：省不了多少依赖，但要自己做重试、schema 转换、usage 统计

---

## 五、边界（明确不做）

沿用 [decisions.md](file:///d:/freelancer/workspace/code/portfolio/.harness/decisions.md) D-001 / D-003：

- ❌ PDF / Excel / Email MIME 解析（Week 2+ 按客户需求扩展）
- ❌ Web UI（FastAPI 自动文档即界面）
- ❌ 多模型自动 fallback 切换
- ❌ 图片 OCR
- ❌ 数据库持久化（无状态 API，不存用户数据 —— 同时也是隐私卖点）

## 六、外部依赖

| 依赖 | 是否已就绪 | 备注 |
|------|----------|------|
| OpenAI API Key | ⚠️ 需确认 | 开发调试需要；单测不需要 |
| Render 账号 | ⚠️ 需确认 | 第 5 步部署时需要 |
| Docker 本地环境 | ⚠️ 需确认 | 构建镜像用 |

---

## 下一步

进入第 3 步：产出 `docs/acceptance.md`，3-5 条可脚本检查的验收标准。

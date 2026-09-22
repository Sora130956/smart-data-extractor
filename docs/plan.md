# 实现计划（Implementation Plan）

> 状态：待评审
> 按此顺序实现，每个模块完成后写单测再进入下一个。

---

## 一、模块拆分

文件名统一 PEP8 小写下划线，类名大驼峰（`contact.py` 内定义 `Contact`）。

```
src/smart_data_extractor/
├── __init__.py             # 对外导出：extract_data / batch_extract / PRESETS
├── config.py               # 配置（API key / model / MAX_CONCURRENCY）
│
├── models/                 # 纯数据模型，不含业务逻辑
│   ├── __init__.py         # 统一导出 Contact / Invoice / Lead / create_dynamic_model
│   ├── base.py             # ConfidenceBase：confidence 字段约定 + 共用 model_config
│   ├── contact.py          # Contact
│   ├── invoice.py          # Invoice（含 InvoiceLineItem）
│   ├── lead.py             # Lead
│   └── dynamic.py          # create_dynamic_model(schema_dict) 运行时建模
│
├── validators/             # 格式校验，被 models 复用
│   ├── __init__.py         # 导出 validate_email / validate_phone / validate_url / validate_date
│   └── formats.py          # 具体正则与归一化实现
│
├── presets/                # 预制场景：模型 + prompt 绑定
│   ├── __init__.py         # PRESETS 注册表 + get_preset(name)
│   ├── base.py             # Preset dataclass（model_class / prompt_template）
│   ├── contact.py          # CONTACT_PRESET
│   ├── invoice.py          # INVOICE_PRESET
│   └── lead.py             # LEAD_PRESET
│
├── extraction/             # 核心业务逻辑
│   ├── __init__.py         # 导出 extract_data / batch_extract
│   ├── agent.py            # Agent 构造（model 选择 + output_type 绑定）
│   ├── extractor.py        # extract_data 单条提取
│   ├── batch.py            # batch_extract 并发批量（Semaphore）
│   └── cost.py             # calculate_cost（genai_prices 封装）
│
├── api/                    # FastAPI 入口
│   ├── __init__.py         # create_app() 装配
│   ├── routes.py           # /health + /extract + /batch_extract
│   └── schemas.py          # 请求/响应 DTO（与 models/ 区分：这是传输层）
│
└── cli.py                  # Typer CLI 入口（单文件够用，命令少）

tests/                      # 目录结构与 src 一一对应
├── conftest.py             # 共享 fixtures（TestModel agent，function scope）
├── models/
│   ├── test_contact.py
│   ├── test_invoice.py
│   ├── test_lead.py
│   └── test_dynamic.py
├── validators/
│   └── test_formats.py
├── presets/
│   └── test_registry.py    # PRESETS 完整性：三个 key 都在且 model_class 可实例化
├── extraction/
│   ├── test_extractor.py
│   ├── test_batch.py
│   └── test_cost.py
├── api/
│   └── test_routes.py      # httpx.AsyncClient + dependency_overrides
├── test_cli.py             # typer.testing.CliRunner
└── test_integration.py     # 端到端（可选，需真实 API key，默认 skip）

fixtures/
├── contact_sample.txt
├── invoice_sample.txt
└── lead_sample.txt
```

**依赖方向（单向，不允许反向 import）**：

```
config ──┐
         ▼
validators ──▶ models ──▶ presets ──▶ extraction ──▶ api / cli
```

---

## 二、实现顺序与依赖

### 阶段 1：基础设施（Day 1）

#### 1.1 `config.py` —— 配置管理

- 读取 `OPENAI_API_KEY`（或 `.env`）
- 默认 model = `"openai:gpt-4o-mini"`
- 并发控制：`MAX_CONCURRENCY = 5`

**依赖**：无
**验收**：`from smart_data_extractor.config import get_api_key` 可正常读取环境变量

#### 1.2 `models/` —— 数据模型包

**功能**：
- `base.py`：`ConfidenceBase`，统一 confidence 字段约定与 `model_config`
- `contact.py` / `invoice.py` / `lead.py`：各自一个 BaseModel，字段配对 `xxx_confidence: float = Field(ge=0.0, le=1.0)`
- `dynamic.py`：`create_dynamic_model(schema_dict)` 运行时构造 Pydantic 模型
- `__init__.py`：统一导出，外部只写 `from smart_data_extractor.models import Contact`

**依赖**：`validators/`
**单测**：`tests/models/test_contact.py` 等，一个模型一个文件
```python
# tests/models/test_contact.py
def test_contact_model():
    c = Contact(name="John", name_confidence=0.9, email=None, email_confidence=0.0)
    assert c.name == "John"

# tests/models/test_dynamic.py
def test_dynamic_model():
    schema = {"fields": {"product_name": {"type": "string", "required": True}}}
    Model = create_dynamic_model(schema)
    assert "product_name" in Model.model_fields
```

---

### 阶段 2：核心提取逻辑（Day 2）

#### 2.1 `validators/` —— 格式校验包

**功能**：
- `formats.py`：email / phone / URL / date 的正则与归一化实现
- 无效格式 → 返回 `None`，由 models 层把对应 confidence 置 0.0
- `__init__.py` 导出校验函数，供 `models/` 的 `@field_validator` 调用

**依赖**：无（最底层）
**单测**：`tests/validators/test_formats.py`（纯函数测试）+ `tests/models/test_contact.py`（验证模型集成后的行为）
```python
# tests/models/test_contact.py
def test_email_validator():
    c = Contact(email="invalid-email", email_confidence=0.8)
    assert c.email is None
    assert c.email_confidence == 0.0
```

#### 2.2 `presets/` —— 预制场景包

**功能**：
- `base.py`：`Preset` dataclass，含 `model_class`、`prompt_template`
- `contact.py` / `invoice.py` / `lead.py`：各导出一个 `XXX_PRESET` 常量
- `__init__.py`：`PRESETS` 注册表 + `get_preset(name)`，未知 name 抛明确异常
- prompt 模板明确指示："Missing fields return null. Provide confidence score 0.0-1.0 for each field."

**依赖**：`models/`
**单测**：`tests/presets/test_registry.py`
```python
def test_presets_registry():
    assert set(PRESETS) == {"contact", "invoice", "lead"}
    for p in PRESETS.values():
        assert issubclass(p.model_class, BaseModel)
```

#### 2.3 `extraction/extractor.py` —— 单条提取

**功能**：
- `extract_data(text: str, preset: str | None, schema_dict: dict | None) -> dict`
- Agent 构造下沉到 `extraction/agent.py`：`Agent(model=..., output_type=ModelClass)`
- 返回：`{"data": {...}, "tokens_used": {...}, "cost_usd": float}`

**依赖**：`models/` + `presets/` + `extraction/cost.py`
**单测**：`tests/extraction/test_extractor.py`（用 `TestModel`，离线）
```python
def test_extract_contact_preset():
    result = extract_data("John Smith, john@acme.com", preset="contact")
    assert "data" in result
    assert "name" in result["data"]
    assert "tokens_used" in result
```

#### 2.4 `extraction/cost.py` —— 成本追踪

**功能**：
- `calculate_cost(usage: RunUsage, model_ref: str) -> float`
- 封装 `genai_prices.calc_price`

**依赖**：无（genai-prices 已随 pydantic-ai 安装）
**单测**：`tests/extraction/test_cost.py`（纯函数，给定 usage 断言 cost > 0 且量级正确）

---

### 阶段 3：批量处理与并发（Day 3）

#### 3.1 `extraction/batch.py` —— 批量提取

**新增函数**：
```python
async def batch_extract(
    texts: list[str],
    preset: str | None,
    schema_dict: dict | None
) -> dict:
    sem = asyncio.Semaphore(MAX_CONCURRENCY)
    async def _extract_one(text):
        async with sem:
            return await extract_data(text, preset, schema_dict)
    
    results = await asyncio.gather(*[_extract_one(t) for t in texts])
    total_cost = sum(r["cost_usd"] for r in results)
    total_tokens = {"input": sum(...), "output": sum(...)}
    return {"results": results, "total_cost_usd": total_cost, "total_tokens": total_tokens}
```

**依赖**：`extraction/extractor.py`
**单测**：`tests/extraction/test_batch.py`
```python
async def test_batch_extract():
    texts = ["text1", "text2", "text3"]
    result = await batch_extract(texts, preset="contact")
    assert len(result["results"]) == 3
    assert result["total_cost_usd"] > 0
```

---

### 阶段 4：API 端点（Day 4）

#### 4.1 `api/` —— FastAPI 包

**结构**：
- `schemas.py`：`ExtractRequest` / `ExtractResponse` / `BatchExtractRequest` 等传输层 DTO
- `routes.py`：路由实现，提取逻辑通过依赖注入拿到，便于测试时 `dependency_overrides`
- `__init__.py`：`create_app()` 装配路由，`app = create_app()` 供 uvicorn 使用

**端点**：
- `GET /health` → `{"status": "ok"}`
- `POST /extract` → `{"text": str, "preset": str?, "schema": dict?}` → 单次提取结果
- `POST /batch_extract` → `{"texts": list[str], ...}` → 批量结果

**依赖**：`extraction/`
**单测**：`tests/api/test_routes.py`（`httpx.AsyncClient` + `dependency_overrides` 注入 fake extractor，不打真实网络）
```python
async def test_extract_endpoint(client):
    resp = await client.post("/extract", json={"text": "...", "preset": "contact"})
    assert resp.status_code == 200
    assert "data" in resp.json()
```

---

### 阶段 5：CLI 入口（Day 5 上午）

#### 5.1 `cli.py` —— Typer CLI

**命令**：
```bash
extractor extract --text "..." --preset contact
extractor extract --text "..." --schema schema.json
extractor batch --input batch.jsonl --preset contact --output results.json
```

**依赖**：`extraction/`
**单测**：`tests/test_cli.py`（用 `typer.testing.CliRunner`）
```python
def test_cli_extract_preset():
    runner = CliRunner()
    result = runner.invoke(app, ["extract", "--text", "John Smith", "--preset", "contact"])
    assert result.exit_code == 0
    assert "name" in result.stdout
```

**集成到 `pyproject.toml`**：
```toml
[project.scripts]
extractor = "smart_data_extractor.cli:app"
```

---

### 阶段 6：测试覆盖与修复（Day 5 下午）

#### 6.1 运行全部验收标准（AC-1 到 AC-5）

```bash
# 创建 fixtures/
mkdir -p fixtures
echo "John Smith, CTO at Acme Corp, john@acme.com, +1-555-0100" > fixtures/contact_sample.txt
echo "Invoice #INV-001, Date: 2024-01-15, Vendor: Acme Corp, Total: $1,500.00, Tax: $150.00" > fixtures/invoice_sample.txt
echo "Jane Doe, jane@startup.io, +1-555-0200, interested in SaaS product" > fixtures/lead_sample.txt

# 运行验收脚本（docs/acceptance.md 里的命令）
bash scripts/run_acceptance.sh
```

#### 6.2 修复失败项

若某个 AC 失败，回到对应模块修复并重跑单测。

---

### 阶段 7：部署准备（Day 6）

#### 7.1 Dockerfile

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN pip install uv && uv sync --frozen
COPY . .
EXPOSE 8000
CMD ["uv", "run", "uvicorn", "smart_data_extractor.api:app", "--host", "0.0.0.0", "--port", "8000"]
```

#### 7.2 本地构建与测试

```bash
docker build -t smart-extractor .
docker run -e OPENAI_API_KEY=$OPENAI_API_KEY -p 8000:8000 smart-extractor

# 冒烟测试
curl http://localhost:8000/health
curl -X POST http://localhost:8000/extract -H "Content-Type: application/json" -d '{"text": "...", "preset": "contact"}'
```

#### 7.3 部署到 Render

- 连接 GitHub 仓库
- 环境变量：`OPENAI_API_KEY`
- 部署后获取公网 URL（如 `https://smart-extractor.onrender.com`）

---

### 阶段 8：Demo 视频与文档（Day 7）

#### 8.1 录制 Demo 视频（2 分钟）

**脚本**：
1. 展示 CLI：`extractor extract --text "..." --preset contact`（15 秒）
2. 展示 API：Postman 调用 `/extract` 和 `/batch_extract`（30 秒）
3. 强调卖点：Confidence Score、Cost Tracking（$0.00015/record）、自定义 schema（45 秒）
4. 实时提取 3 条记录，展示批量结果和聚合成本（30 秒）

**工具**：OBS Studio 或 Loom

#### 8.2 完善 README.md

**内容**：
- 一句话介绍："LLM-powered data extraction tool with confidence scoring and cost tracking"
- Quick Start（Docker 一键启动）
- 3 个预制场景示例
- 自定义 schema 示例
- API 文档链接（FastAPI 自动生成的 `/docs`）
- 成本透明度说明："1000 records for under $0.50"
- 技术栈：Pydantic-AI 2.46 + FastAPI + gpt-4o-mini

#### 8.3 准备 Upwork Proposal 模板

基于 `docs/brainstorming-summary.md` 的 Proposal 模板，填入：
- Demo 视频链接
- Live API URL（Render 部署地址）
- GitHub 仓库（公开）

---

## 三、风险与应对

| 风险 | 影响 | 缓解措施 |
|------|------|---------|
| Day 2-3 离线测试写不对 | AC-5 不过 | spike_feasibility.py 已验证 TestModel 可用，复用其模式 |
| Day 4 FastAPI 端点调试慢 | 延后 1 天 | 先跑 CLI（更简单），API 可延后到 Day 5 |
| Day 6 Render 部署失败 | 无公网 URL | 本地 Docker 也能录 Demo，延后解决部署 |
| 真实 API 成本超预算 | 开发期 > $0.10 | 全部单测用 TestModel，只在冒烟测试时调真实 API（< 10 次） |

---

## 四、完成标准

- **代码**：全部模块实现 + 单测覆盖率 > 80%
- **验收**：5 个 AC 全部通过（或 4/5，且剩余 1 项不阻塞 Demo）
- **部署**：Render 有公网 URL，`/health` 返回 200
- **文档**：README 完整，Demo 视频 < 2 分钟
- **Portfolio 就绪**：GitHub 仓库 public，可直接贴进 Upwork Proposal

---

## 下一步

等待用户评审本计划。通过后进入第 5 步：按上述顺序开始实现，每个模块完成后写单测再进入下一个。

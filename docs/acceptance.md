# 验收标准（Acceptance Criteria）

> 状态：**已验收（Phase 6，2026-09-24）—— 5/5 通过**。离线证据：`tests/test_acceptance.py`（14 测试）+ 删 KEY 后全套通过，详见 `docs/review.md` Phase 6。
> 注：bash 示例已按 Phase 5 落地的 CLI 契约（D-009）修订——命令名 `smart-data-extractor`、输入用 `--input-file`（无 stdin 管道）；离线自动化等价物见 `tests/test_acceptance.py`，真实 API 冒烟见 `tests/test_integration.py`（`RUN_INTEGRATION=1` 触发）。
> 每条标准必须可量化、可脚本检查，通过后才能进入实现阶段。

---

## AC-1：三个预制场景的结构化输出

**Given**: 提供纯文本输入（含目标信息）
**When**: 通过 CLI 或 API 指定 `--preset contact/invoice/lead`
**Then**: 返回 JSON，包含所有预定义字段 + confidence + cost

### 验收方式

```bash
# Contact 场景（12 键 = 6 业务字段 + confidence 孪生；拟稿名 title/linkedin 实现为 job_title/website）
uv run smart-data-extractor extract \
  --input-file fixtures/contact_sample.txt --preset contact | \
  jq '.data | keys' | \
  diff - <(echo '["company","company_confidence","email","email_confidence","job_title","job_title_confidence","name","name_confidence","phone","phone_confidence","website","website_confidence"]')

# Invoice 场景（至少含 invoice_number / date / vendor / total / tax / line_items，另有 currency；共 14 键）
uv run smart-data-extractor extract \
  --input-file fixtures/invoice_sample.txt --preset invoice | \
  jq '.data | keys | length >= 12'

# Lead 场景（BANT 十字段：name / email / phone / company / job_title / lead_source / stage / budget_range / timeline / notes；共 20 键）
uv run smart-data-extractor extract \
  --input-file fixtures/lead_sample.txt --preset lead | \
  jq '.data | keys | length >= 12'
```

**预期**：`diff` 无输出（完全匹配），后两个 jq 返回 `true`。

---

## AC-2：自定义 JSON Schema 动态提取

**Given**: 提供自定义 schema JSON（字段名、类型、required 标记）
**When**: 通过 `--schema schema.json` 传入
**Then**: 返回数据结构与 schema 定义完全一致，缺失字段返回 `null` 而非编造值

### 验收方式

```bash
# schema.json
cat > /tmp/schema.json <<'EOF'
{
  "fields": {
    "product_name": {"type": "string", "required": true},
    "price": {"type": "number", "required": true},
    "stock_status": {"type": "string", "required": false}
  }
}
EOF

# 输入不含 stock_status
echo "iPhone 15 Pro costs $999" > /tmp/input.txt
uv run smart-data-extractor extract \
  --input-file /tmp/input.txt --schema /tmp/schema.json | \
  jq '.data.stock_status == null and .data.product_name != null'

# 输出字段集与 schema 定义严格一致（每个 schema 字段附 _confidence 孪生，见 D-004 契约）
uv run smart-data-extractor extract \
  --input-file /tmp/input.txt --schema /tmp/schema.json | \
  jq -c '.data | keys' | \
  diff - <(echo '["price","price_confidence","product_name","product_name_confidence","stock_status","stock_status_confidence"]')
```

**预期**：jq 返回 `true`，`diff` 无输出。

---

## AC-3：Confidence Score + Validation Rules

**Given**: 输入含格式正确与错误的 email/phone
**When**: 提取 Contact
**Then**: 
- 每字段附带 `xxx_confidence` （0.0–1.0）
- email/phone 格式校验失败时，该字段置 `null`，confidence 置 `0.0`
- （Phase 6 落地语义）confidence 归零由 `ConfidenceBase` 的 model_validator 统一保证：任何为 `null` 的字段，其配对 confidence 必为 `0.0`——preset 与动态模型同享

### 验收方式

```bash
# 无效 email
echo "John Smith, invalid-email, +1-555-0100" > /tmp/input.txt
uv run smart-data-extractor extract \
  --input-file /tmp/input.txt --preset contact | \
  jq '.data.email == null and .data.email_confidence == 0.0'

# 有效字段的 confidence 在范围内
echo "John Smith, john@acme.com" > /tmp/input.txt
uv run smart-data-extractor extract \
  --input-file /tmp/input.txt --preset contact | \
  jq '.data.name_confidence >= 0.0 and .data.name_confidence <= 1.0 and .data.email_confidence > 0.0'
```

**预期**：两个 jq 均返回 `true`。

---

## AC-4：Cost Tracking 与批量处理限流

**Given**: 提供 N 条记录批量提取
**When**: 调用 `POST /batch_extract`
**Then**: 
- 每条记录返回 `tokens_used`（input/output 分开）和 `cost_usd`
- 批量返回聚合 `total_cost_usd` 和 `total_tokens`
- 并发数受全局 `ConcurrencyLimiter` 限制（`settings.max_concurrency`，默认 5）——D-006 已取代拟稿的 per-agent `Semaphore(5)`：各 agent 独立 Semaphore 互不感知，无法构成全局上限

### 验收方式

```bash
# 单次提取有成本字段
echo "test" > /tmp/input.txt
uv run smart-data-extractor extract \
  --input-file /tmp/input.txt --preset contact | \
  jq 'has("tokens_used") and has("cost_usd") and .cost_usd > 0'

# 批量提取有聚合成本
cat > /tmp/batch.jsonl <<'EOF'
John Smith, john@acme.com
Jane Doe, jane@example.com
Bob Lee, bob@corp.net
EOF

uv run smart-data-extractor batch \
  --input /tmp/batch.jsonl --preset contact | \
  jq 'has("total_cost_usd") and has("total_tokens") and (.results | length == 3)'

# API 端点等价检查（需先启动 uvicorn）
curl -X POST http://localhost:8000/batch_extract \
  -H "Content-Type: application/json" \
  -d '{"texts": ["..."], "preset": "contact"}' | \
  jq 'has("total_cost_usd") and has("total_tokens")'

# 并发限制（读代码验证全局 limiter；离线断言见 tests/test_acceptance.py::test_ac4_global_concurrency_cap）
rg 'shared_concurrency_limiter' src/smart_data_extractor/extraction/
```

**预期**：两个 jq 返回 `true`，`rg` 命中 `agent.py` 的共享 limiter 定义及其在 batch/CLI 路径的使用。

---

## AC-5：离线测试可运行（零 API 成本）

**Given**: 删除 `OPENAI_API_KEY` 环境变量
**When**: 运行 pytest
**Then**: 全部单测通过，无网络请求

### 验收方式

```bash
# 删除 API key
unset OPENAI_API_KEY

# 运行单测
uv run pytest -v

# 验证无网络调用（respx 或 TestModel mock 全部覆盖）
uv run pytest --co -q | wc -l  # 至少 15 个测试
```

**预期**：pytest exit code 0，全部 PASSED，无 API 错误。

---

## 验收检查清单

在第 5 步实现完成后，按顺序执行（Phase 6 于 2026-09-24 执行完毕，5/5 通过）：

- [x] AC-1：三个预制场景输出字段完整且类型正确（`test_ac1_*`，5 个测试）
- [x] AC-2：自定义 schema 字段集严格一致，缺失字段返回 null（`test_ac2_*`，3 个测试）
- [x] AC-3：confidence 在 [0.0, 1.0]，格式校验生效（`test_ac3_*`，4 个测试；含 Phase 6 修复：`ConfidenceBase` 归零 validator）
- [x] AC-4：成本字段存在且 > 0，批量聚合正确，并发受限（`test_ac4_*`，3 个测试）
- [x] AC-5：删除 API key 后单测全过（155 passed / 2 skipped，integration 默认 skip）

**全部通过，进入第 6 步（部署与 Demo）。**

---

## 通过标准

- **5/5 通过** → 进入部署
- **4/5 通过** → 评估剩余项是否阻塞 Demo，若不阻塞可延后到 Week 2
- **≤ 3/5 通过** → 返回第 4 步修复实现，重新验收

## 附注

- `fixtures/` 已创建：`contact_sample.txt` / `invoice_sample.txt` / `lead_sample.txt`（Phase 6）
- CLI 命令名已确认：`uv run smart-data-extractor`（`pyproject.toml [project.scripts]`，Phase 5 落地）
- 离线验收自动化：`tests/test_acceptance.py`（TestModel 注入，D-005）；真实 API 冒烟：`tests/test_integration.py`（`RUN_INTEGRATION=1` 触发，默认 skip，2 次调用 < $0.01）
- API 端点验收（AC-4 的 curl 部分）需先启动 `uvicorn smart_data_extractor.api:create_app --factory`

# 验收标准（Acceptance Criteria）

> 状态：待评审
> 每条标准必须可量化、可脚本检查，通过后才能进入实现阶段。

---

## AC-1：三个预制场景的结构化输出

**Given**: 提供纯文本输入（含目标信息）
**When**: 通过 CLI 或 API 指定 `--preset contact/invoice/lead`
**Then**: 返回 JSON，包含所有预定义字段 + confidence + cost

### 验收方式

```bash
# Contact 场景
echo "John Smith, CTO at Acme Corp, john@acme.com, +1-555-0100" | \
  uv run extractor extract --preset contact | \
  jq '.data | keys' | \
  diff - <(echo '["name","name_confidence","email","email_confidence","phone","phone_confidence","company","company_confidence","title","title_confidence","linkedin","linkedin_confidence"]')

# Invoice 场景（至少含 invoice_number / date / vendor / total_amount / tax / items）
cat fixtures/invoice_sample.txt | \
  uv run extractor extract --preset invoice | \
  jq '.data | keys | length >= 6'

# Lead 场景（至少含 name / email / phone / company / industry / interested_product）
cat fixtures/lead_sample.txt | \
  uv run extractor extract --preset lead | \
  jq '.data | keys | length >= 6'
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
echo "iPhone 15 Pro costs $999" | \
  uv run extractor extract --schema /tmp/schema.json | \
  jq '.data.stock_status == null and .data.product_name != null'

# 输出字段集与 schema 定义严格一致
echo "..." | \
  uv run extractor extract --schema /tmp/schema.json | \
  jq '.data | keys | sort' | \
  diff - <(echo '["price","product_name","stock_status"]' | jq -c 'sort')
```

**预期**：jq 返回 `true`，`diff` 无输出。

---

## AC-3：Confidence Score + Validation Rules

**Given**: 输入含格式正确与错误的 email/phone
**When**: 提取 Contact
**Then**: 
- 每字段附带 `xxx_confidence` （0.0–1.0）
- email/phone 格式校验失败时，该字段置 `null`，confidence 置 `0.0`

### 验收方式

```bash
# 无效 email
echo "John Smith, invalid-email, +1-555-0100" | \
  uv run extractor extract --preset contact | \
  jq '.data.email == null and .data.email_confidence == 0.0'

# 有效字段的 confidence 在范围内
echo "John Smith, john@acme.com" | \
  uv run extractor extract --preset contact | \
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
- 并发数受 Semaphore 限制（不超过 5 并发）

### 验收方式

```bash
# 单次提取有成本字段
echo "test" | \
  uv run extractor extract --preset contact | \
  jq 'has("tokens_used") and has("cost_usd") and .cost_usd > 0'

# 批量提取有聚合成本
cat > /tmp/batch.jsonl <<'EOF'
{"text": "John Smith, john@acme.com"}
{"text": "Jane Doe, jane@example.com"}
{"text": "Bob Lee, bob@corp.net"}
EOF

curl -X POST http://localhost:8000/batch_extract \
  -H "Content-Type: application/json" \
  -d '{"texts": ["..."], "preset": "contact"}' | \
  jq 'has("total_cost_usd") and has("total_tokens") and (.results | length == 3)'

# 并发限制（读代码验证 Semaphore(5)）
rg 'Semaphore\(5\)' src/
```

**预期**：前两个 jq 返回 `true`，`rg` 找到 `Semaphore(5)` 实例化。

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

在第 5 步实现完成后，按顺序执行：

- [ ] AC-1：三个预制场景输出字段完整且类型正确
- [ ] AC-2：自定义 schema 字段集严格一致，缺失字段返回 null
- [ ] AC-3：confidence 在 [0.0, 1.0]，格式校验生效
- [ ] AC-4：成本字段存在且 > 0，批量聚合正确，并发受限
- [ ] AC-5：删除 API key 后单测全过

**全部通过才能进入第 6 步（部署与 Demo）。**

---

## 通过标准

- **5/5 通过** → 进入部署
- **4/5 通过** → 评估剩余项是否阻塞 Demo，若不阻塞可延后到 Week 2
- **≤ 3/5 通过** → 返回第 4 步修复实现，重新验收

## 附注

- `fixtures/` 目录需在实现阶段创建，放入 3 个场景的测试样本文本
- 脚本中的 `uv run extractor` 是 CLI 入口，实际命令名待 `pyproject.toml [project.scripts]` 确认
- API 端点验收（AC-4 批量部分）需先启动 `uvicorn` 服务

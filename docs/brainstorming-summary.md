# Smart-Data-Extractor - 头脑风暴总结

> 创建日期：2026-09-22
> 目标：7天内完成可展示的数据提取Portfolio，立即投标Upwork

---

## 核心定位

**Smart-Data-Extractor**: An LLM-powered toolkit that transforms messy, unstructured text into clean, validated, structured data.

**一句话需求**：
- **Who（为谁）**：Upwork上需要数据提取服务的客户（$10-400预算的中小型项目）
- **What（做什么）**：LLM驱动的数据提取工具，从非结构化纯文本中提取结构化数据
- **Why（价值）**：自动化人工整理工作 + 作为Portfolio快速破零接单

---

## 市场调研结论（基于20个Upwork职位样本）

### 输入格式需求分布

| 格式类型 | 职位数 | 占比 | 平均预算 | 技术复杂度 |
|---------|-------|------|---------|-----------|
| 纯文本 | 16 | **80%** | $10-2500 | 低 |
| PDF处理 | 2 | 10% | $40-$35/h | 高（需OCR）|
| Excel/Sheets | 2 | 10% | $400-$25/h | 中 |

**关键发现**：
- ✅ 纯文本覆盖80%需求，是破零的最佳切入点
- ✅ Line 2的$10职位（"Build an LLM API for Structured Data Extraction"）完全匹配MVP目标
- ❌ PDF/Excel虽然预算更高，但技术门槛高，不适合7天MVP

---

## 功能范围（Day 1-7 MVP）

### ✅ 包含功能

#### 1. 输入支持
- **纯文本输入**（raw text, API responses, chat logs, copied content）
- 明确在README标注："支持纯文本，可按需扩展PDF/Excel"

#### 2. 预制场景（3个）
1. **Contact Extraction（联系方式提取）** ⭐⭐⭐⭐⭐
   - 字段：name, email, phone, company, title, linkedin
   - 场景：从邮件/聊天中提取客户信息

2. **Invoice Data Extraction（发票数据提取）** ⭐⭐⭐⭐
   - 字段：invoice_number, date, vendor, total_amount, tax, items
   - 场景：从文本化的发票中提取结构化数据

3. **Lead/Customer Info（潜在客户信息）** ⭐⭐⭐⭐
   - 字段：name, email, phone, company, industry, interested_product, budget
   - 场景：从询价邮件/表单提交中提取销售线索

#### 3. 自定义Schema
- 用户提供JSON schema定义字段
- 支持：字段名、类型（string/number/boolean）、必填/可选

示例：
```json
{
  "fields": {
    "product_name": {"type": "string", "required": true},
    "price": {"type": "number", "required": true},
    "availability": {"type": "string", "required": false}
  }
}
```

#### 4. 质量保证功能

**Confidence Score（置信度评分）**
- 每个字段返回0-1的置信度
- 低于阈值标记"需要人工审核"
- 示例输出：
```json
{
  "name": "John Smith",
  "name_confidence": 0.95,
  "email": "john@example.com",
  "email_confidence": 0.88,
  "phone": null,
  "phone_confidence": 0.0
}
```

**Validation Rules（验证规则）**
- Email格式验证（正则）
- Phone格式验证（国际格式）
- Date格式归一化
- URL验证

**Fallback Handling（降级处理）**
- 必填字段缺失时的行为选项：
  - `strict`: 返回错误
  - `partial`: 返回部分结果
  - `retry`: 重试N次

**Cost Tracking（成本追踪）**
- 每次提取返回：`tokens_used`, `cost_usd`
- 批量提取返回汇总：`total_cost`, `avg_cost_per_record`

#### 5. 批量处理
- asyncio并发处理多条文本
- Semaphore控制并发数（避免rate limit）
- 进度条显示
- 成本统计

#### 6. 双入口
**CLI用法**：
```bash
# 预制场景
python extract.py --preset contact --input emails.txt

# 自定义schema
python extract.py --schema my_schema.json --input data.txt
```

**API用法**（FastAPI）：
```python
POST /extract
{
  "text": "...",
  "preset": "contact"  # 或自定义schema
}
```

#### 7. 部署与展示
- 部署到Render（Free tier）
- 2分钟Demo视频
- GitHub README完整版（架构图 + 使用示例 + 真实效果数据）

### ❌ 明确不做（Week 2+按需扩展）

- ❌ **PDF解析**：需2-3天，OCR调试复杂
- ❌ **Excel/CSV读取**：需1天
- ❌ **邮件MIME解析**：需1天
- ❌ **Web UI界面**：纯API足够，客户可自己集成
- ❌ **多模型自动切换**：首单用gpt-4o-mini即可
- ❌ **Webhook集成**：客户要求时再加
- ❌ **图片OCR**：Week 4+（需Vision API）

---

## 技术栈

### 核心依赖
- **Python 3.11+**
- **Pydantic v2**：数据验证和模型定义
- **Pydantic-AI**：LLM结构化输出（核心能力）
- **FastAPI**：API入口
- **Uvicorn**：ASGI服务器
- **Typer/Click**：CLI入口
- **httpx**：异步HTTP客户端
- **pytest + pytest-asyncio**：测试框架
- **respx**：HTTP mock（测试时拦截OpenAI API调用）

### 外部服务
- **OpenAI API**（gpt-4o-mini）：主力模型
- 可选支持：Claude（Anthropic API）

### 部署
- **Docker**：容器化
- **Render**：托管平台（Free tier）

---

## 产品卖点（对Upwork客户）

1. **Zero-config for common scenarios** — 3个预制场景开箱即用
2. **Fully customizable** — 自定义JSON schema支持任意字段
3. **Quality guaranteed** — 验证规则 + 置信度评分，不瞎编数据
4. **Cost transparent** — 每次提取显示token用量和成本
5. **Production-ready** — FastAPI接口可直接集成到客户系统

---

## 验收标准（高层级）

详细标准见 `docs/acceptance.md`，核心要求：

1. **功能完整性**：
   - 3个预制场景可用
   - 自定义schema可用
   - CLI和API双入口工作正常

2. **质量保证**：
   - 缺失字段返回null，不瞎编
   - Email/Phone格式验证有效
   - Confidence score准确反映提取质量

3. **性能与成本**：
   - 批量处理100条不触发rate limit
   - 平均成本 < $0.005/条

4. **可展示性**：
   - 部署到Render可访问
   - README完整（包含真实效果数据）
   - 2分钟Demo视频录制完成

5. **测试覆盖**：
   - 按CLAUDE.md五步验收通过
   - pytest全绿，断网跑仍然通过（无真网外呼）

---

## Proposal模板（针对数据提取类单子）

```markdown
Hi [Client Name],

I've built exactly what you're looking for — an LLM-powered extraction API 
that handles unstructured text → structured JSON with validation.

Live Demo: [your-render-url]
GitHub: [repo-link]
Video: [2-min demo]

What makes it reliable:
✅ FastAPI endpoint (plug-and-play)
✅ Pydantic validation (no invented data)
✅ Confidence scoring (flag uncertain extractions)
✅ Missing fields return null (not fake data)
✅ Cost transparent ($0.003 per record with gpt-4o-mini)

I can adapt this to your exact fields in < 1 day.

Timeline: [X] days
Budget: $[Y]

Ready to start immediately.

Best,
[Your name]
```

---

## 扩展路径（接单后）

### Week 8-10：投标 + 破零
- 每天投1-2份数据提取类单子
- 搜索关键词：`AI extraction`, `structured data`, `scraping`, `parsing`
- 目标：前2周投10-15份，争取破零

### Week 11+：根据客户需求扩展
- **客户要PDF** → 花2-3天加OCR支持（AWS Textract或pdfplumber）
- **客户要Excel** → 花1天加pandas读取/写入
- **客户要邮件** → 花1天加email.parser
- **客户要图片** → 花2-3天加Vision API

### Week 6-8（接5+单后）：考虑转型RAG
- 单价更高（$300-2000）
- 技术：向量数据库 + 检索
- 从"提取"升级到"问答"

---

## 风险与应对

### 风险1：7天做不完
**应对**：
- Day 6砍掉部署，专心做本地demo和视频
- 用localhost录demo视频也可以
- 部署延后到接到第一个客户再做

### 风险2：投标0回复
**分析checklist**：
- 是不是选错单子类型（预算<$100竞争激烈）
- Proposal太长/太技术/没展示作品
- Profile的Job Success Score和评价数（0单0评价确实吃亏）
- 报价太高（第一单可以报低价破零）

**应对**：
- 换搜索关键词（试试"Chinese + AI"差异化）
- Proposal加上"First project on Upwork, offering discounted rate"
- 主动在客户发布后1小时内投（竞争少）

### 风险3：接到单子但交付不了
**预防**：
- Proposal里明确说"I've built a similar system"（附demo链接）
- 客户描述里有不懂的技术，先私下验证能不能3天学会
- 第一单选预算$50-150的（试错成本低）

---

## 成本预算

### 学习成本（Day 1-7）
- API调用：开发测试预计$5-10
- 部署：Render Free tier（$0）
- 总计：<$15

### 投标成本（Week 2-4）
- Connects：每份proposal 16 connects
- 投15份：240 connects
- 当前余额：151 connects
- 充值建议：先买100 connects ($15)

---

## 下一步

按照CLAUDE.md工作流，下一步是：

**第 2 步：可行性分析、技术选型**
- 确认Pydantic-AI是否支持所有计划功能
- 成本估算（OpenAI API调用成本）
- 技术风险评估
- 部署方案确认

# GLM-OCR 迁移设计

- **日期**：2026-10-11
- **状态**：待审查
- **关联决策**：延续 [D-030](file:///d:/freelancer/workspace/code/smart-data-extractor/.harness/decisions.md#L667)（默认模型切到 `glm-4.5v`），本次是架构级替换，预计记为 D-031

## 背景

当前 OCR 方案（D-030）使用通用视觉模型 `glm-4.5v`，通过 pydantic-ai 的 `Agent` + `OpenAIChatModel` 封装，以手写 prompt（`OCR_PROMPT`）要求模型输出 JSON 格式的文本块和坐标；PDF 处理方式是先用 PyMuPDF（`fitz`）把每页渲染成 PNG 图片，再逐页循环调用模型。

智谱提供了专用的文档解析模型 `glm-ocr`（独立的 `layout_parsing` REST 接口），具备原生版面解析能力：

- 直接接收 PDF/图片原始文件（最多100页），一次调用返回所有页的结构化版面元素（`layout_details`，按页分组的二维数组），每个元素含 `label`（`text`/`table`/`formula`/`image`）、`bbox_2d`（文档声称 0-1 归一化坐标，但实测可能是像素坐标——不能机械信任，见 D-032）、`content`
- 定价仅 0.2 元/百万 token（输入输出同价），远低于 `glm-4.5v` 的阶梯价
- 用户已购买小额资源包用于验证

用户决策：**完全替换**为 `glm-ocr`，不保留 `glm-4.5v` 路径。

## 架构

```
parse_pdf(pdf_bytes) / parse_image(image_bytes, media_type)
         │
         ├─ pdf_to_images(pdf_bytes)  ← 保留，仅用于生成 pages_images 预览底图
         │                              （前端叠框展示用，与OCR调用链路解耦）
         │
         └─ _call_glm_ocr(file_bytes)  ← 新增，httpx 直调
                  │
                  POST {base_url}/layout_parsing
                  { model: "glm-ocr", file: base64(file_bytes) }
                  │
                  └─ 响应：{ layout_details, usage, data_info, ... }
                           │
                           ├─ 按页遍历 layout_details
                           │    过滤 label ∈ {text, table}
                           │    table.content 去 HTML 标签取纯文本
                           │    bbox_2d(0-1) 原样放入 box 字段
                           │
                           └─ 组装现有响应 shape：
                              {text, pages, pages_blocks, pages_failed,
                               pages_images, tokens_used, cost_usd}
```

被移除的组件：`OCR_PROMPT`、`GlmChatModel`、`build_glm_model()`、`build_ocr_agent()`、`_ocr_page()`/`_ocr_images()` 逐页循环、`_GLM_FREE_MODELS`/`_GLM_4_5V_TIERS` 阶梯价表、`_parse_grounding()`（自由文本JSON解析不再需要）。

新增的组件：`_call_glm_ocr()`（httpx 请求封装，PDF和图片共用）、`_extract_text_blocks()`（label过滤 + HTML去标签）、`calculate_glm_ocr_cost()`（固定单价计费）。

## 关键决策

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 是否保留 `glm-4.5v` 路径 | 完全替换，不保留回退选项 |
| 2 | PDF页面图处理 | 保留 `pdf_to_images()`，仅服务前端预览；不复用 glm-ocr 的 `layout_visualization`（带标注框，不是干净原图） |
| 3 | 调用架构 | 放弃 pydantic-ai Agent 抽象，改用 `httpx` 直调 REST |
| 4 | PDF 传输方式 | 整份 PDF 原始字节一次性调用（利用 glm-ocr 原生多页解析），不再逐页渲染后循环调用 |
| 5 | 图片场景 | `parse_image` 复用同一个 `_call_glm_ocr()` 底层函数，图片字节直传 |
| 6 | 文件传输格式 | base64 直传（无外部可访问 URL） |
| 7 | 失败语义 | API 调用（HTTP/网络层）失败 → 整份报错，抛异常给上层；API 调用成功但某页 `layout_details` 缺失/空 → 该页标记进 `pages_failed`，其余页正常返回 |
| 8 | label 过滤 | 保留 `text` + `table`，暂不处理 `image`/`formula` |
| 9 | table 内容处理 | `content`（HTML格式）去标签取纯文本，参与全文拼接和字段匹配 |
| 10 | 坐标转换 | 扩展 `normalize_boxes()`（[locate.py](file:///d:/freelancer/workspace/code/smart-data-extractor/src/smart_data_extractor/extraction/locate.py#L90-L131)）新增一档：坐标全部 ≤1.0 时判定为 0-1 归一化，×100 后复用现有裁剪/交换逻辑；**后续 D-032 发现实测坐标可能是像素，改为用 `data_info.pages[].width/height` 分轴精确换算，猜测档位仅作无宽高信息时的 fallback** |
| 11 | 计费 | 新建 `calculate_glm_ocr_cost()`，按固定单价 0.2 元/百万 token（`usage.prompt_tokens + usage.completion_tokens`）计算，不复用阶梯价逻辑 |
| 12 | 可选请求参数 | 仅传 `model` + `file`（及PDF场景可选的 `start_page_id`/`end_page_id`），不传 `request_id`/`user_id`/`return_crop_images`/`need_layout_visualization` |
| 13 | `config.py` | `glm_model` 默认值改为 `"glm-ocr"`；`glm_base_url` 保持基址不变，由调用代码拼接 `/layout_parsing` 路径 |
| 14 | 测试 mock | 从 `httpx2.MockTransport`（服务于 pydantic-ai/openai SDK）改为 `httpx.MockTransport`（直接 mock httpx 请求） |
| 15 | 置信度 | glm-ocr 响应**不含**置信度字段（与另一款手写OCR工具 `/files/ocr` 的 `probability` 参数是完全不同的产品，不适用于本次迁移） |

## 兼容性硬约束

前端"整份一条/每页一条"切换功能（[SettingsModal.tsx](file:///d:/freelancer/workspace/code/smart-data-extractor/frontend/src/components/settings/SettingsModal.tsx)、[PasteTextInput.tsx](file:///d:/freelancer/workspace/code/smart-data-extractor/frontend/src/components/input/PasteTextInput.tsx#L80-100)）完全依赖 `pages`/`pages_images`/`pages_blocks` 三个数组按页对齐（index 对应页码-1）。新实现必须保证 `layout_details[i]` 正确映射为 `pages[i]`/`pages_blocks[i]`，顺序和页数严格对齐，否则"每页一条"会错位。这是本次迁移中唯一不可破坏的下游契约；[schemas.py](file:///d:/freelancer/workspace/code/smart-data-extractor/src/smart_data_extractor/api/schemas.py#L165-182) 的 `ParsePdfResponse` 字段定义不变。

## 数据流细节

**请求**：
```
POST {glm_base_url}/layout_parsing
{
  "model": "glm-ocr",
  "file": "<base64编码的PDF或图片字节>"
}
```

**响应解析**：
```
_extract_text_blocks(layout_details_for_page: list[dict]) -> list[OcrBlock]:
    过滤 item.label in ("text", "table")
    若 label == "table": content = strip_html_tags(item.content)
    否则: content = item.content
    返回 [{"text": content, "box": item.bbox_2d}, ...]
```

- `pages_blocks[i]` = `_extract_text_blocks(layout_details[i])`
- `pages[i]` = 该页所有 block 的 `text` 按顺序拼接（block间用换行连接）；若该页 `layout_details` 缺失/为空，`pages[i] = None` 且 `i+1` 加入 `pages_failed`
- `text` = 所有非 `None` 的 `pages[i]` 拼接
- `tokens_used` = `usage.total_tokens`
- `cost_usd` = `calculate_glm_ocr_cost(usage)`

**错误处理**：httpx 请求异常（网络错误、超时、非2xx状态码）直接向上抛出，由 API 层现有的异常处理（[routes.py](file:///d:/freelancer/workspace/code/smart-data-extractor/src/smart_data_extractor/api/routes.py#L237-271) 的 `try/except ValueError`）捕获转为 HTTP 错误响应。

## 测试

- 单元测试改用 `httpx.MockTransport` 构造离线 client，覆盖：
  - 多页PDF正常解析（文本拼接、pages_blocks对齐、tokens/cost计算）
  - 某页 `layout_details` 缺失 → 该页进 `pages_failed`，其余页不受影响
  - `table` 元素 HTML 去标签
  - `image`/`formula` 元素被过滤
  - 单图场景（`parse_image`）复用同一调用函数
  - production-default 路径（省略参数时用 `config.py` 默认值构建调用）
  - API 请求失败（4xx/5xx/网络异常）→ 异常向上抛出
- 删除：基于 `GlmChatModel`/`build_ocr_agent`/`_parse_grounding`/阶梯价计费的测试
- `test_config.py` 的 `test_settings_glm_model_default` 断言改为 `"glm-ocr"`

## 影响范围

- 代码：[ocr.py](file:///d:/freelancer/workspace/code/smart-data-extractor/src/smart_data_extractor/extraction/ocr.py)（大改）、[locate.py](file:///d:/freelancer/workspace/code/smart-data-extractor/src/smart_data_extractor/extraction/locate.py)（`normalize_boxes` 扩展）、[config.py](file:///d:/freelancer/workspace/code/smart-data-extractor/src/smart_data_extractor/config.py)（默认值）
- 测试：[test_ocr.py](file:///d:/freelancer/workspace/code/smart-data-extractor/tests/extraction/test_ocr.py)（大改）、[test_config.py](file:///d:/freelancer/workspace/code/smart-data-extractor/tests/test_config.py)
- 文档：README.md、render.yaml（计价说明同步更新）、decisions.md（追加 D-031）、state.md
- 前端：不涉及改动（契约不变）

## 遗留开放问题（本次设计未处理，留待后续）

- `daily_quota_per_ip`/`daily_quota_global` 配额数值是否需要调整（glm-ocr 单价远低于 glm-4.5v，可能可以放宽配额）
- 真实 API 验证方式（用户手动用小额资源包测试，还是编写一次性诊断脚本）——建议在实现计划中安排一步"真实调用验证响应结构"，确认后再锁定解析代码细节

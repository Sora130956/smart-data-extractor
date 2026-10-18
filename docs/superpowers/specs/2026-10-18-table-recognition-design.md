# 表格识别设计

- **日期**：2026-10-18
- **状态**：待审查
- **关联**：延续 [GLM-OCR 迁移设计](2026-10-11-glm-ocr-migration-design.md)；置信度机制参考 D-046（`confidence_fusion.py`）

## 背景

表格结构的图片目前无法被正确识别。根因：GLM-OCR `layout_parsing` 对 `label=table` 的块返回 HTML 表格，后端在 `ocr.py` 的 `_extract_text_blocks` 中把 HTML 标签去掉压成纯文本，行列、合并单元格和多层表头全部丢失，下游 DeepSeek 提取因此出错。

表格结构无法预估（合并单元格、多层表头），不适合套用现有的扁平字段模板。因此表格走独立模式：直接展示并校对 OCR 识别出的表格。

## 决策摘要

| 项目 | 决策 |
|---|---|
| 进入条件 | 自动判定：版面分析有 `table` 块且占页面面积足够大（阈值为配置项，初值 0.3） |
| 取值 | 直接取 GLM-OCR 返回的 HTML 表格，不调用 DeepSeek |
| 模板 | 表格模式不使用模板，不拍平表头，不逐字段配置阈值 |
| 单元格置信度 | 取匹配到的 `hand_write` 行的 `probability.min` |
| 复核阈值 | 固定 0.85，复用前端 `CONFIDENCE_HIGH`；低于 0.85 或无置信度的非空单元格标记需复核 |
| 单元格定位 | 在 `table` 块框内，把单元格文字匹配到 `hand_write` 行，取行框 |
| 交互 | 格内只显示置信度；单击 = 在原图高亮；双击 = 复核并编辑 |

## 范围

**范围内**：表格自动判定、HTML 表格解析、单元格置信度与定位、详情页表格渲染与编辑、历史记录存储、导出。

**范围外**：表格模板、表头拍平成字段、逐字段阈值、DeepSeek 自评、多记录文档（如签到表）的字段化提取。以后如需模板，可在单元格结构上叠加。

## 后端

### 流程

```
parse_pdf / parse_image
   ├─ _call_glm_ocr(file)           → layout_details（保留 table 的 HTML）
   ├─ _collect_ocr_lines(...)       → hand_write 逐行 {page, text, box, min_prob}
   └─ 判定：是否有足够大的 table 块
        ├─ 否 → 原有字段提取流程（不变）
        └─ 是 → 表格模式：解析 HTML → 匹配行 → 产出 tables
```

### 保留 HTML

`_extract_text_blocks` 保持现有行为（供原流程使用），新增函数提取 `table` 块的原始 HTML 与 `bbox_2d`（同样按现有逻辑归一到 0-100），不改变原流程的返回值。

### 解析 HTML

用标准库 `html.parser` 解析 `<table>`，得到行列矩阵：

- 读取 `rowspan`、`colspan`，单元格只记录一次，占位格不重复。
- 表头（`<th>` 或 `<thead>`）记 `is_header: true`。
- 单元格文本去首尾空白。

### 单元格结构

```json
{
  "row": 0, "col": 0,
  "rowspan": 1, "colspan": 2,
  "text": "姓名",
  "is_header": true,
  "confidence": 0.93,
  "bbox": {"page": 1, "box": [x1, y1, x2, y2]},
  "needs_review": false,
  "edited": false
}
```

表格结构：`{page, bbox, rows, cols, cells[]}`，响应新增 `tables: Table[]` 与 `mode: "table" | "fields"`。

### 单元格匹配 hand_write 行

1. 只考虑与 `table` 块框重叠（`_MIN_LINE_OVERLAP = 0.5`）的 `hand_write` 行。
2. 对每个非空单元格，在这些行的文本里做归一化子串匹配（去空白、全半角统一），选位置最靠前且未被占用的匹配。
3. 匹配成功：置信度 = 该行 `min_prob`；高亮框 = 行框。若行内含多个单元格文字，按单元格文字在行文本中的字符偏移比例切出子框。
4. 匹配失败：`confidence = null`、`bbox = null`、`needs_review = true`，界面提示"无置信度"。
5. 空单元格不参与匹配，不标记需复核。
6. 非空单元格 `needs_review = confidence is None or confidence < 0.85`。

`/files/ocr` 不可用或失败时：所有非空单元格按无置信度处理，整表可见但全部需复核，并给出整表级提示，不中断流程。

### 多表与多页

按页、按块顺序产出 `tables[]`，每个 `table` 块一个条目。

## 前端

### 类型

`frontend/src/types/extraction.ts` 新增 `TableCell`、`TableResult`；结果对象新增 `mode` 与 `tables`。`mode !== "table"` 时详情页行为不变。

### 详情页（`ResultDetailModal.tsx`）

布局沿用已认可的原型：

- 左侧：把 `cells` 渲染为 HTML 表格，保留 `rowspan`/`colspan`，表头区分样式。
- 右侧：原图对照，复用现有高亮框机制。
- 多张表以标签切换。

单元格交互：

- 格内只显示置信度数值；`needs_review` 的格子用警示色；已编辑显示"已修改"；无置信度显示"—"并带提示。
- 单击：选中单元格，在原图上画出该格 `bbox` 并定位；无 `bbox` 时不画框并提示。
- 双击：进入编辑，Enter 保存、Esc 取消。保存后 `edited = true`，`needs_review = false`，置信度改为"已修改"，原置信度保留在数据里。
- 表头单元格同样支持单击和双击。

阈值复用 `frontend/src/utils/confidence.ts` 的 `CONFIDENCE_HIGH`；后端写入的 `needs_review` 为准，前端仅在编辑后更新。

### 历史记录

保存 `mode` 与 `tables`（单元格数组），沿用"剥离 blob URL、仅存文本与结构"的现有做法。

### 导出

- Excel：按原行列导出，`rowspan`/`colspan` 对应合并单元格，每张表一个工作表。
- JSON：导出每张表的 `rows × cols` 二维文本数组，并附带 `cells` 元数据。
- 沿用现有导出入口，`mode === "table"` 时切换到表格导出分支。

## 错误处理

| 情形 | 行为 |
|---|---|
| `table` 块 HTML 无法解析 | 回退原字段流程，并记录日志 |
| `/files/ocr` 失败 | 整表标记需复核，提示"无置信度信号" |
| 单元格匹配失败 | 单格标记需复核，不画框 |
| 判定为表格但实际是误判 | 详情页提供"改用字段提取"入口，重新走原流程 |
| PDF 多页，部分页失败 | 沿用 `pages_failed` 机制，成功页照常展示 |

## 测试

后端（先写测试）：

- HTML 解析：简单表、含 `rowspan`/`colspan`、多层表头、空单元格。
- 判定：有大 `table` 块进入表格模式；无 `table` 或面积过小走原流程。
- 匹配：命中、同行多格切子框、未命中标记需复核、`/files/ocr` 失败的降级。
- 阈值：0.85 边界（0.85 不需复核，0.849 需复核）。
- 原流程回归：`mode = "fields"` 时响应与现状一致。

前端：

- 渲染：合并单元格结构正确。
- 交互：单击高亮、双击编辑保存后状态变化。
- 导出：合并单元格对应、JSON 结构。

## 开放问题

- 面积阈值 0.3 的初值需用真实样本验证。
- 同一单元格文字在表内重复（如多行"是"）时，按"位置最靠前且未被占用"匹配，可能错配到邻行；先采用该策略，若样本显示问题明显，再引入行位置约束。

# Issue #9 设计：字段名（JSON key）编辑

- 日期：2026-10-12
- 状态：已批准（用户于 2026-10-12 批准）
- 关联：[GitHub issue #9](https://github.com/Sora130956/smart-data-extractor/issues/9) — "允许用户自己定义 JSON schema，即允许编辑字段名（不是展示名），帮助用户直接导入到自己的 CRM 系统中。"

## 1. 背景与目标

项目已支持自定义 schema（增删字段、编辑展示名/类型/描述、保存 localStorage），但**字段名（field_name，即 JSON 输出的 key）不可编辑**：自定义字段的 key 由 LLM 生成 snake_case。用户无法让输出 JSON 的 key 对齐自己 CRM 系统的字段名，只能导出后再手工改名。

本期补上这一块：让用户直接控制 JSON 输出的 key。

**范围（已确认）**：仅字段名编辑。自定义 schema 的创建/保存已有，不重复做；不做后端 schema CRUD 持久化。

**术语对齐 issue 原文**：字段名 = field_name（JSON key）；展示名 = display_name（UI 标签）。

## 2. 用户视角交互

- SchemaEditor（`frontend/src/components/input/SchemaEditor.tsx`）每行新增"**字段名**"输入列，位于展示名列右侧（~130px，固定宽）
- 原"字段名"列文案改为"**展示名**"——现有 i18n 键 `schema.fieldName` 标注的其实是展示名列，属于历史语义错位，本期一并修正
- **Preset 字段**：预填后端 field_name（`usePresetSchema` 已返回，seed 时已保留在 `SchemaField.fieldName`），可直接改
- **新增字段**：`fieldName: null`，输入框留空，placeholder 提示"留空自动生成"；填写则以用户输入为准
- **清空语义**：清空输入框 → `fieldName` 置回 `null`（回到自动生成）；校验只对非空值生效
- 保存的 schema / preset override（localStorage）自动携带 key，无需改 uiStore

## 3. 提交链路语义：用户 key 永远优先

现状缺陷（`frontend/src/App.tsx` L234）：

```ts
if (!needsResolve(f) && f.fieldName) field.field_name = f.fieldName;
```

用户同时改 key 和展示名时 `needsResolve` 为 true，`field_name` 不传，用户编辑的 key 被 LLM 重新生成静默覆盖。

修正为：

```ts
if (f.fieldName) field.field_name = f.fieldName;
```

- `needsResolve` 的字段名部分仅保留"null → 需 LLM 生成"语义
- **不新增** `originalFieldName` 基线：key 不是 diff 对象，任何非空用户 key 都直传；`isSchemaModified` 已是"任何 setCustomFields 置 true"的布尔，key 编辑自然触发 custom 提交路径

## 4. 校验规则（前后端同一套）

| 规则 | 拒绝示例 | 原因 |
|---|---|---|
| `^[a-z][a-z0-9_]*$` | `First Name`、`姓名`、`1st`、`first-name` | Python 标识符合法性（`create_dynamic_model` 依赖） |
| 不以 `_confidence` 结尾 | `score_confidence` | 撞 `create_dynamic_model` 自动生成的孪生置信度字段（静默覆盖） |
| 非 Python 关键字 | `class`、`import` | `create_model(**field_definitions)` 崩溃 |
| 不以 `model_` 开头 | `model_version` | pydantic 保留命名空间 |
| 同一 schema 内唯一 | 两个字段都叫 `email` | dict key 冲突 |

实现：

- **前端**：新建 `frontend/src/utils/fieldName.ts`，导出 `validateFieldName(name: string): string | null`（返回 i18n 错误键或 null）与查重辅助；SchemaEditor 输入时行内红框 + 错误文案；`handleStart` 开头对全部字段再查一遍，存在非法/重复 key 则显示错误、不提交
- **后端**（`src/smart_data_extractor/extraction/schema_resolve.py`）：
  - `resolve_schema` L127-128 之后：对每个 caller 提供的 field_name 跑 `_validate_identifier`（当前只查重，且 caller 之间的重复会静默覆盖 `schema_fields[name]`）
  - caller 名字之间查重，重复 raise ValueError（routes 层现有 ValueError → 400 映射）
  - `_validate_identifier` 扩展 `keyword.iskeyword` 与 `model_` 前缀检查（同时惠及 LLM 生成路径，保持两路一致）
- **不改 `create_dynamic_model`**：`/extract` 直传 schema 是既有 API 面、非本期引入（review.md R-7 已记录该风险），范围聚焦

## 5. i18n 变更

`frontend/src/i18n/zh.json` / `en.json` 的 `schema` 段：

| 键 | 值（zh / en） | 用途 |
|---|---|---|
| `schema.displayName`（新，值取代原 `fieldName` 的位置语义） | 展示名 / Display Name | 展示名列（原 `schema.fieldName` 词条改指此列） |
| `schema.fieldName`（复用键名，指新列） | 字段名 / Field Name | key 列 |
| `schema.fieldNamePlaceholder`（新） | 留空自动生成 / Auto if empty | 新增字段 placeholder |
| `schema.fieldNameInvalid`（新） | 仅限小写字母、数字、下划线，且以字母开头 / Lowercase letters, digits, underscores; must start with a letter | 行内错误 |
| `schema.fieldNameDuplicate`（新） | 字段名重复 / Duplicate field name | 行内错误 |

注意：`schema.fieldName` 键名保留给新列，原列引用处（SchemaEditor L163/L172）改用 `schema.displayName`，避免两个"字段名"混淆。

## 6. 兼容性

- **旧批次**：遵循 D-016 快照惯例，改 key 只影响后续提取；旧结果/JSON 导出保持旧 key，无迁移
- **Excel 导出**：列头仍用展示名（non-goal）
- **JSON 导出**：天然以 field_name 为 key，无需改动——CRM 导入诉求的直接收益点
- **Smart 模式**（infer）：无编辑器，不受影响
- **SavedSchema / presetOverrides（localStorage）**：`SchemaField` 类型已有 `fieldName`，旧数据无该属性的（预设字段 seed 自带）向后兼容

## 7. 测试与验收标准

验收标准（可脚本检查）：

1. 编辑 preset 字段 key 后提取，输出 JSON 的 key = 用户填写值（前端集成断言）
2. 非法 key（大写 / 中文 / 空格 / `class` / `model_x` / `x_confidence`）被前端行内拦截；后端 `resolve_schema` 对 caller 名 raise ValueError（pytest 断言）
3. 两个字段同 key：前端行内报错，后端 ValueError
4. 留空 key → LLM 自动生成（回归现有行为，现有测试不改语义全绿）
5. `uv run pytest -q` 与 `npm test` 全绿

测试落点：

- 前端：`SchemaEditor.test.tsx`（列渲染 / 编辑 / 非法红框 / 重复提示 / placeholder / 清空回自动生成）、`App.test.tsx`（key 传递、key+展示名同时改时 key 保留、非法 key 阻断提交）、`utils/fieldName.test.ts`（校验函数全分支，新建）
- 后端：`tests/extraction/test_schema_resolve.py`（已存在，追加 caller 名校验 / 查重 / keyword / `model_` / `_confidence` 用例）

## 8. 改动文件清单

| 文件 | 改动 |
|---|---|
| `frontend/src/components/input/SchemaEditor.tsx` | 新列 + 行内校验 |
| `frontend/src/App.tsx` | key 优先规则（L234）+ handleStart 提交前校验 |
| `frontend/src/utils/fieldName.ts`（新） | 共享校验函数 |
| `frontend/src/i18n/zh.json`、`en.json` | 词条（见第 5 节） |
| `src/smart_data_extractor/extraction/schema_resolve.py` | caller 名校验 + 查重 + `_validate_identifier` 扩展 |

## 9. 明确不做（non-goals)

- 后端 schema CRUD / SQLite 持久化
- Excel 导出列头切换为 field_name 的选项
- `create_dynamic_model` 内部加固（既有 API 面，R-7 已记录）
- 字段重排序、嵌套结构等广义 schema 编辑

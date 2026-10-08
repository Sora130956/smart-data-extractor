# Smart Data Extractor 掌控地图

> 最后更新：2026-10-07 · 对应 commit：`ad5c25a`
> 本文档是项目的认知索引，不是 API 文档。读完应能回答：这个项目能做什么、数据怎么流、哪些决策是故意的。
> 当前进度：已完成第 1–3 章，第 4–12 章待生成。

## 1. 一句话定位

把杂乱的纯文本（联系人签名、发票文字、销售线索描述）交给 LLM，产出字段固定、带置信度、带成本账单的结构化 JSON；提供 HTTP API 与 CLI 两个入口，用户既可以用内置场景模板，也可以自带 JSON schema 定义任意字段。

- **输入**：一段或多段非结构化纯文本（不支持 PDF / Excel / 图片，这是刻意的范围裁剪）
- **输出**：`{data, tokens_used, cost_usd, cost_cny}`；批量额外给 `succeeded/failed` 与成本聚合
- **服务对象**：Upwork 上有 data extraction 需求的中小预算客户

## 2. 能力清单（对外视角）

| 能力 | 承载模块 | 对客户怎么说 |
|---|---|---|
| 预制场景提取（contact / invoice / lead） | [\_\_init\_\_.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/presets/__init__.py#L84-L111) | 常见场景开箱即用，不用你定义字段，直接出表 |
| 自定义字段提取（任意 JSON schema） | [dynamic.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/models/dynamic.py) | 你要哪几列、什么类型，自己定；系统按你的定义出数据 |
| 字段名自动生成（中文显示名 → snake_case 键） | [schema_resolve.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/extraction/schema_resolve.py#L59-L136) | 你用中文写想要的字段，系统自动生成规范的英文字段名 |
| 每字段置信度评分 | [extractor.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/extraction/extractor.py#L17-L24) | 每个值都带可信度分数，低分的你人工复核，不用全量检查 |
| 格式校验（email / phone） | [formats.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/validators/formats.py) | 邮箱电话这类有固定格式的，系统会拦掉明显错误的值 |
| 成本追踪（token 用量 + USD/CNY） | [cost.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/extraction/cost.py) | 每次调用花了多少钱当场可见，预算完全透明 |
| 批量并发提取 + 部分容错 | [batch.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/extraction/batch.py#L19-L28) | 一次传几百条并行处理；个别脏数据失败不影响其他结果 |
| 双语字段描述（中/英） | [\_\_init\_\_.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/presets/__init__.py#L70-L81) | 中英文界面都能正确显示字段含义 |
| 自定义补充指令 | [extractor.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/extraction/extractor.py#L43-L51) | 有特殊业务规则可以用一句话告诉系统，不用改代码 |
| 离线可测（零 API 成本） | [state.md](file:///d:/freelancer/workspace/code/portfolio/.harness/state.md#L89) | 功能回归不烧 API 预算，交付前验证成本为零 |

## 3. 对外边界（★ 需亲自确认）

### 3.1 HTTP 接口

应用装配入口：[\_\_init\_\_.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/__init__.py#L22-L28)（uvicorn 目标 `smart_data_extractor.api:app`）

| 方法 | 路径 | 作用 | 定义位置 |
|---|---|---|---|
| GET | `/health` | 存活探针，固定返回 `{"status":"ok"}` | [routes.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/routes.py#L49-L51) |
| GET | `/presets` | 列出全部可选场景（给前端下拉框） | [routes.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/routes.py#L54-L56) |
| GET | `/presets/{name}/schema` | 某场景的字段清单（含双语显示名），未知名 → 404 | [routes.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/routes.py#L59-L65) |
| POST | `/extract` | 单条文本提取 | [routes.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/routes.py#L68-L80) |
| POST | `/schema/resolve` | 把编辑器里的字段（中文显示名）解析成 schema 键名 | [routes.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/routes.py#L83-L92) |
| POST | `/batch_extract` | 批量提取，部分容错，返回成功/失败计数与成本聚合 | [routes.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/routes.py#L95-L124) |

**请求的硬约束**（三个 POST 端点共享，违反直接 422，不进业务层）：

| 约束 | 含义 | 位置 |
|---|---|---|
| `preset` XOR `schema` | 必须二选一，都给或都不给都报错 | [schemas.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/schemas.py#L27-L37) |
| preset 必须已注册 | 错误信息会列出所有可用 preset | [schemas.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/schemas.py#L31-L37) |
| schema 每个字段必带 `type` | 否则 422，避免 models 层抛 KeyError | [schemas.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/schemas.py#L38-L47) |
| `text` 非空 / `texts` 非空列表 | 长度约束在 DTO 上 | [schemas.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/schemas.py#L51-L56) |

**错误码分层**（D-008）：

| 码 | 什么情况 | 在哪决定 |
|---|---|---|
| 422 | 请求形状不对（上表任一约束） | pydantic 校验，FastAPI 自动转换 |
| 400 | 形状对但业务拒绝（业务层 `ValueError`） | [routes.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/routes.py#L78-L79) |
| 404 | preset 名不存在（仅 `/presets/{name}/schema`） | [routes.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/routes.py#L63-L64) |
| 200 + `error` 字段 | 批量中个别条目失败（不是 HTTP 错误） | [routes.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/api/routes.py#L100-L116) |

### 3.2 CLI 命令

入口名 `smart-data-extractor`，定义在 [cli.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/cli.py#L34-L37)

| 命令 | 必填参数 | 可选参数 | 定义位置 |
|---|---|---|---|
| `extract` | `--text` XOR `--input-file`；`--preset` XOR `--schema` | `--instructions` | [cli.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/cli.py#L94-L123) |
| `batch` | `--input`（JSONL，一行一条文本）；`--preset` XOR `--schema` | `--instructions`、`--output` | [cli.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/cli.py#L126-L187) |

**输出流约定**（D-009，这是 CLI 能被脚本消费的关键）：

- 数据 JSON → stdout（或 `--output` 文件）
- 汇总与错误 → stderr，所以 stdout 可以直接 `| jq`
- 位置：[cli.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/cli.py#L171-L184)

**退出码**，对应 API 的错误分层：

| 码 | 含义 | 位置 |
|---|---|---|
| 0 | 全部成功 | — |
| 1 | 业务错误，或批量中有任一条失败（部分结果仍已写出） | [cli.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/cli.py#L85-L91)、[cli.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/cli.py#L186-L187) |
| 2 | 用法错误（参数组合非法、文件读不了、JSON 不合法） | [cli.py](file:///d:/freelancer/workspace/code/portfolio/src/smart_data_extractor/cli.py#L40-L82) |

> 这一节是你和外界的合同。建议逐条跳进去扫一眼参数和返回，其它章节都可以只读摘要。

## 4–12 章

待生成。

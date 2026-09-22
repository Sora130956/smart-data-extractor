"""第 2 步可行性 spike：验证 Pydantic-AI 2.46 是否支持 MVP 所需的 4 项核心能力。

运行：uv run python spike_feasibility.py
不需要 API key —— 全部用 TestModel 离线跑。
"""

from typing import Optional

from pydantic import BaseModel, Field, create_model
from pydantic_ai import Agent
from pydantic_ai.models.test import TestModel
from pydantic_ai.usage import RunUsage


# ---------- 能力 1：静态 schema 结构化输出 + 每字段 confidence ----------
class Contact(BaseModel):
    name: Optional[str] = None
    name_confidence: float = Field(default=0.0, ge=0.0, le=1.0)
    email: Optional[str] = None
    email_confidence: float = Field(default=0.0, ge=0.0, le=1.0)


def check_static_schema() -> None:
    agent = Agent(TestModel(), output_type=Contact)
    r = agent.run_sync("John Smith, john@example.com")
    assert isinstance(r.output, Contact), type(r.output)
    print(f"[1] 静态 schema 结构化输出  OK  -> {r.output!r}")


# ---------- 能力 2：运行时动态构造 schema（用户自定义 JSON schema） ----------
TYPE_MAP = {"string": str, "number": float, "integer": int, "boolean": bool}


def build_model(name: str, fields: dict) -> type[BaseModel]:
    defs = {}
    for fname, spec in fields.items():
        py_type = TYPE_MAP[spec["type"]]
        if spec.get("required", False):
            defs[fname] = (py_type, ...)
        else:
            defs[fname] = (Optional[py_type], None)
    return create_model(name, **defs)


def check_dynamic_schema() -> None:
    user_schema = {
        "product_name": {"type": "string", "required": True},
        "price": {"type": "number", "required": True},
        "availability": {"type": "string", "required": False},
    }
    Model = build_model("CustomExtraction", user_schema)
    agent = Agent(TestModel(), output_type=Model)
    r = agent.run_sync("iPhone 15 Pro, $999, in stock")
    assert set(r.output.model_dump()) == set(user_schema)
    print(f"[2] 动态 schema（自定义字段）OK  -> {r.output.model_dump()}")


# ---------- 能力 3：token usage 统计（Cost Tracking 基础） ----------
def check_usage_tracking() -> None:
    agent = Agent(TestModel(), output_type=Contact)
    r = agent.run_sync("Jane Doe, jane@corp.io")
    usage: RunUsage = r.usage
    assert usage.input_tokens is not None and usage.output_tokens is not None
    print(
        f"[3] usage 统计 OK  -> input={usage.input_tokens} "
        f"output={usage.output_tokens} requests={usage.requests}"
    )


# ---------- 能力 4：离线可测（TestModel 不发网络请求） ----------
def check_offline() -> None:
    import os

    saved = os.environ.pop("OPENAI_API_KEY", None)
    try:
        agent = Agent(TestModel(), output_type=Contact)
        agent.run_sync("no api key needed")
        print("[4] 无 API key 离线可跑 OK（测试可 CI 化）")
    finally:
        if saved:
            os.environ["OPENAI_API_KEY"] = saved


# ---------- 能力 5：成本查价表（genai-prices 已随 pydantic-ai 安装） ----------
def check_pricing() -> None:
    from genai_prices import calc_price

    usage = RunUsage(input_tokens=1000, output_tokens=500)
    p = calc_price(usage, model_ref="gpt-4o-mini")
    print(
        f"[5] 成本计算 OK  -> gpt-4o-mini 1k in/500 out = "
        f"${p.total_price:.6f}"
    )


if __name__ == "__main__":
    check_static_schema()
    check_dynamic_schema()
    check_usage_tracking()
    check_offline()
    check_pricing()
    print("\n全部 5 项能力核验通过")

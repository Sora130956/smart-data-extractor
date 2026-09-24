"""Tests for smart_data_extractor.cli (Typer CLI, offline via injected fakes).

DI discipline (same as tests/extraction/test_batch.py): the commands call
the module-level names ``cli.extract_data`` / ``cli.batch_extract``, so
tests monkeypatch those seams with async fakes. No real network, no
TestModel needed — the CLI's own responsibility is argument wiring, JSON
serialization, and exit codes, not extraction itself.
"""

import json

import pytest
from typer.testing import CliRunner

import smart_data_extractor.cli as cli_module
from smart_data_extractor.cli import app

SCHEMA = {"product_name": {"type": "string", "required": True}}


@pytest.fixture
def runner() -> CliRunner:
    return CliRunner()


def _make_fake_extract(error: Exception | None = None):
    """Fake extract_data seam: records calls, echoes input in the payload."""
    calls: list[dict] = []

    async def fake_extract(
        text, preset=None, schema_dict=None, *, model=None, model_ref=None,
        instructions=None,
    ):
        calls.append(
            {
                "text": text,
                "preset": preset,
                "schema_dict": schema_dict,
                "instructions": instructions,
            }
        )
        if error is not None:
            raise error
        return {
            "data": {"echo": text},
            "tokens_used": {"input": len(text), "output": 1},
            "cost_usd": 0.001,
        }

    return fake_extract, calls


def _make_fake_batch(fail_indices: frozenset[int] = frozenset()):
    """Fake batch_extract seam: echoes inputs, fails items at fail_indices."""
    calls: list[dict] = []

    async def fake_batch(
        texts, preset=None, schema_dict=None, *, model=None,
        instructions=None, return_exceptions=False,
    ):
        calls.append(
            {
                "texts": list(texts),
                "preset": preset,
                "schema_dict": schema_dict,
                "instructions": instructions,
                "return_exceptions": return_exceptions,
            }
        )
        results = []
        for i, t in enumerate(texts):
            if i in fail_indices:
                results.append(
                    {
                        "data": None,
                        "tokens_used": {"input": 0, "output": 0},
                        "cost_usd": 0.0,
                        "error": "RuntimeError: boom",
                    }
                )
            else:
                results.append(
                    {
                        "data": {"echo": t},
                        "tokens_used": {"input": len(t), "output": 1},
                        "cost_usd": 0.001,
                        "error": None,
                    }
                )
        ok = len(texts) - len(fail_indices)
        return {
            "results": results,
            "total_cost_usd": 0.001 * ok,
            "total_tokens": {
                "input": sum(len(t) for i, t in enumerate(texts) if i not in fail_indices),
                "output": ok,
            },
        }

    return fake_batch, calls


def _write_jsonl(path, lines):
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


# --- extract ---


def test_extract_text_preset_prints_json(runner, monkeypatch):
    fake, calls = _make_fake_extract()
    monkeypatch.setattr(cli_module, "extract_data", fake)

    result = runner.invoke(
        app, ["extract", "--text", "John Smith, john@acme.com", "--preset", "contact"]
    )

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert payload["data"] == {"echo": "John Smith, john@acme.com"}
    assert payload["cost_usd"] == 0.001
    assert calls == [
        {
            "text": "John Smith, john@acme.com",
            "preset": "contact",
            "schema_dict": None,
            "instructions": None,
        }
    ]


def test_extract_input_file_reads_content(runner, monkeypatch, tmp_path):
    src = tmp_path / "contact.txt"
    src.write_text("Jane Doe, jane@startup.io", encoding="utf-8")
    fake, calls = _make_fake_extract()
    monkeypatch.setattr(cli_module, "extract_data", fake)

    result = runner.invoke(
        app, ["extract", "--input-file", str(src), "--preset", "contact"]
    )

    assert result.exit_code == 0
    assert calls[0]["text"] == "Jane Doe, jane@startup.io"


def test_extract_schema_file_parses_json(runner, monkeypatch, tmp_path):
    schema_file = tmp_path / "schema.json"
    schema_file.write_text(json.dumps(SCHEMA), encoding="utf-8")
    fake, calls = _make_fake_extract()
    monkeypatch.setattr(cli_module, "extract_data", fake)

    result = runner.invoke(
        app, ["extract", "--text", "iPhone 15 Pro, $999", "--schema", str(schema_file)]
    )

    assert result.exit_code == 0
    assert calls[0]["preset"] is None
    assert calls[0]["schema_dict"] == SCHEMA


def test_extract_forwards_instructions(runner, monkeypatch):
    fake, calls = _make_fake_extract()
    monkeypatch.setattr(cli_module, "extract_data", fake)

    result = runner.invoke(
        app,
        ["extract", "--text", "some text", "--preset", "contact",
         "--instructions", "be strict"],
    )

    assert result.exit_code == 0
    assert calls[0]["instructions"] == "be strict"


def test_extract_rejects_both_text_and_input_file(runner, monkeypatch, tmp_path):
    fake, _ = _make_fake_extract()
    monkeypatch.setattr(cli_module, "extract_data", fake)
    src = tmp_path / "a.txt"
    src.write_text("content", encoding="utf-8")

    result = runner.invoke(
        app,
        ["extract", "--text", "inline", "--input-file", str(src), "--preset", "contact"],
    )

    assert result.exit_code == 2
    assert "exactly one" in result.stderr.lower()


def test_extract_rejects_both_preset_and_schema(runner, monkeypatch, tmp_path):
    fake, _ = _make_fake_extract()
    monkeypatch.setattr(cli_module, "extract_data", fake)
    schema_file = tmp_path / "schema.json"
    schema_file.write_text(json.dumps(SCHEMA), encoding="utf-8")

    result = runner.invoke(
        app,
        ["extract", "--text", "some text", "--preset", "contact",
         "--schema", str(schema_file)],
    )

    assert result.exit_code == 2


def test_extract_rejects_missing_target(runner, monkeypatch):
    """Neither --preset nor --schema -> usage error."""
    fake, _ = _make_fake_extract()
    monkeypatch.setattr(cli_module, "extract_data", fake)

    result = runner.invoke(app, ["extract", "--text", "some text"])

    assert result.exit_code == 2


def test_extract_extraction_error_exits_1(runner, monkeypatch):
    """Downstream ValueError (e.g. unknown preset) -> stderr + exit 1."""
    fake, _ = _make_fake_extract(error=ValueError("Unknown preset 'nope'"))
    monkeypatch.setattr(cli_module, "extract_data", fake)

    result = runner.invoke(app, ["extract", "--text", "some text", "--preset", "nope"])

    assert result.exit_code == 1
    assert "nope" in result.stderr


# --- batch ---


def test_batch_writes_output_file_and_summary(runner, monkeypatch, tmp_path):
    src = tmp_path / "batch.jsonl"
    _write_jsonl(src, ["text one", "", "text two", "text three"])  # blank skipped
    out = tmp_path / "results.json"
    fake, calls = _make_fake_batch()
    monkeypatch.setattr(cli_module, "batch_extract", fake)

    result = runner.invoke(
        app,
        ["batch", "--input", str(src), "--preset", "contact", "--output", str(out)],
    )

    assert result.exit_code == 0
    # Fake saw the three non-blank lines, tolerant mode, right preset.
    assert calls[0]["texts"] == ["text one", "text two", "text three"]
    assert calls[0]["preset"] == "contact"
    assert calls[0]["return_exceptions"] is True
    # Output file holds the full batch payload.
    written = json.loads(out.read_text(encoding="utf-8"))
    assert [r["data"] for r in written["results"]] == [
        {"echo": "text one"},
        {"echo": "text two"},
        {"echo": "text three"},
    ]
    # Summary goes to stderr so stdout stays parseable.
    assert "3" in result.stderr
    assert "succeeded" in result.stderr


def test_batch_prints_json_to_stdout_without_output(runner, monkeypatch, tmp_path):
    src = tmp_path / "batch.jsonl"
    _write_jsonl(src, ["a", "b"])
    fake, _ = _make_fake_batch()
    monkeypatch.setattr(cli_module, "batch_extract", fake)

    result = runner.invoke(app, ["batch", "--input", str(src), "--preset", "contact"])

    assert result.exit_code == 0
    payload = json.loads(result.stdout)
    assert len(payload["results"]) == 2
    assert payload["results"][1]["data"] == {"echo": "b"}


def test_batch_exit_1_when_any_item_failed(runner, monkeypatch, tmp_path):
    src = tmp_path / "batch.jsonl"
    _write_jsonl(src, ["ok one", "bad", "ok two"])
    out = tmp_path / "results.json"
    fake, _ = _make_fake_batch(fail_indices=frozenset({1}))
    monkeypatch.setattr(cli_module, "batch_extract", fake)

    result = runner.invoke(
        app,
        ["batch", "--input", str(src), "--preset", "contact", "--output", str(out)],
    )

    # Partial results are still written (tolerant mode), but exit signals failure.
    assert result.exit_code == 1
    written = json.loads(out.read_text(encoding="utf-8"))
    assert written["results"][1]["data"] is None
    assert "boom" in written["results"][1]["error"]
    assert "1 failed" in result.stderr


def test_batch_rejects_empty_input(runner, monkeypatch, tmp_path):
    src = tmp_path / "empty.jsonl"
    _write_jsonl(src, ["", "  "])
    fake, _ = _make_fake_batch()
    monkeypatch.setattr(cli_module, "batch_extract", fake)

    result = runner.invoke(app, ["batch", "--input", str(src), "--preset", "contact"])

    assert result.exit_code == 2


def test_batch_rejects_missing_target(runner, monkeypatch, tmp_path):
    src = tmp_path / "batch.jsonl"
    _write_jsonl(src, ["a"])
    fake, _ = _make_fake_batch()
    monkeypatch.setattr(cli_module, "batch_extract", fake)

    result = runner.invoke(app, ["batch", "--input", str(src)])

    assert result.exit_code == 2


def test_batch_forwards_instructions(runner, monkeypatch, tmp_path):
    src = tmp_path / "batch.jsonl"
    _write_jsonl(src, ["a", "b"])
    fake, calls = _make_fake_batch()
    monkeypatch.setattr(cli_module, "batch_extract", fake)

    result = runner.invoke(
        app,
        ["batch", "--input", str(src), "--preset", "contact",
         "--instructions", "be terse"],
    )

    assert result.exit_code == 0
    assert calls[0]["instructions"] == "be terse"

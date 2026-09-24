"""Typer CLI entry point.

Usage:
    smart-data-extractor extract --text "..." | --input-file msg.txt
        (--preset contact | --schema schema.json) [--instructions "..."]
    smart-data-extractor batch --input batch.jsonl
        (--preset contact | --schema schema.json) [--instructions "..."]
        [--output results.json]

Output contract:
    - Data (result JSON) goes to stdout, or to --output for batch.
    - Diagnostics (batch summary, errors) go to stderr, so stdout stays
      parseable / pipeable.

Exit codes:
    0  success (batch: every item succeeded)
    1  extraction/business error (unknown preset, bad schema shape), or
       at least one failed batch item (partial results are still written)
    2  usage error (bad argument combination, unreadable JSONL/schema)

Batch semantics follow D-008: the CLI opts into per-item tolerance
(``return_exceptions=True``) so one bad record cannot lose the whole run.
"""

import asyncio
import json
from pathlib import Path
from typing import Annotated, Optional

import typer

from smart_data_extractor.extraction import batch_extract, extract_data

app = typer.Typer(
    help="LLM-powered structured data extraction from messy text.",
    no_args_is_help=True,
)


def _load_text(text: Optional[str], input_file: Optional[Path]) -> str:
    """Resolve --text / --input-file (exactly one) into the input text."""
    if (text is None) == (input_file is None):
        raise typer.BadParameter("provide exactly one of --text or --input-file")
    if text is not None:
        if not text.strip():
            raise typer.BadParameter("--text must not be empty")
        return text
    content = input_file.read_text(encoding="utf-8").strip()
    if not content:
        raise typer.BadParameter(f"--input-file is empty: {input_file}")
    return content


def _load_target(
    preset: Optional[str], schema_path: Optional[Path]
) -> tuple[Optional[str], Optional[dict]]:
    """Resolve --preset / --schema (exactly one) into extractor arguments."""
    if (preset is None) == (schema_path is None):
        raise typer.BadParameter("provide exactly one of --preset or --schema")
    if preset is not None:
        return preset, None
    try:
        data = json.loads(schema_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise typer.BadParameter(
            f"--schema file is not valid JSON: {exc}"
        ) from exc
    if not isinstance(data, dict):
        raise typer.BadParameter("--schema file must contain a JSON object")
    return None, data


def _read_jsonl(path: Path) -> list[str]:
    """Read batch input: one text per non-blank line."""
    texts = [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    if not texts:
        raise typer.BadParameter(f"--input file contains no texts: {path}")
    return texts


def _run_extraction(coro) -> dict:
    """Run the async extraction call, mapping business errors to exit 1."""
    try:
        return asyncio.run(coro)
    except ValueError as exc:
        typer.secho(f"Error: {exc}", err=True, fg=typer.colors.RED)
        raise typer.Exit(1) from exc


@app.command()
def extract(
    text: Annotated[
        Optional[str], typer.Option(help="Input text, inline.")
    ] = None,
    input_file: Annotated[
        Optional[Path],
        typer.Option(exists=True, help="Read input text from a file."),
    ] = None,
    preset: Annotated[
        Optional[str],
        typer.Option(help="Preset name: contact / invoice / lead."),
    ] = None,
    schema: Annotated[
        Optional[Path],
        typer.Option(exists=True, help="JSON file defining a custom schema."),
    ] = None,
    instructions: Annotated[
        Optional[str],
        typer.Option(help="Extra instructions appended to the extraction prompt."),
    ] = None,
) -> None:
    """Extract structured data from a single text; result JSON on stdout."""
    source_text = _load_text(text, input_file)
    preset_name, schema_dict = _load_target(preset, schema)

    result = _run_extraction(
        extract_data(source_text, preset_name, schema_dict, instructions=instructions)
    )
    typer.echo(json.dumps(result, indent=2))


@app.command()
def batch(
    input: Annotated[
        Path,
        typer.Option(
            exists=True, help="JSONL file: one input text per non-blank line."
        ),
    ],
    preset: Annotated[
        Optional[str],
        typer.Option(help="Preset name: contact / invoice / lead."),
    ] = None,
    schema: Annotated[
        Optional[Path],
        typer.Option(exists=True, help="JSON file defining a custom schema."),
    ] = None,
    instructions: Annotated[
        Optional[str],
        typer.Option(help="Extra instructions forwarded to every extraction."),
    ] = None,
    output: Annotated[
        Optional[Path],
        typer.Option(help="Write the batch result JSON here instead of stdout."),
    ] = None,
) -> None:
    """Batch-extract every line of a JSONL file concurrently.

    Failed lines become per-item error entries, so partial results survive;
    exit code is 1 when any line fails.
    """
    texts = _read_jsonl(input)
    preset_name, schema_dict = _load_target(preset, schema)

    result = _run_extraction(
        batch_extract(
            texts,
            preset_name,
            schema_dict,
            instructions=instructions,
            return_exceptions=True,
        )
    )

    failed = sum(1 for r in result["results"] if r.get("error"))
    succeeded = len(result["results"]) - failed
    typer.secho(
        f"Processed {len(result['results'])} texts: "
        f"{succeeded} succeeded, {failed} failed. "
        f"Total cost: ${result['total_cost_usd']:.6f} "
        f"(tokens in: {result['total_tokens']['input']}, "
        f"out: {result['total_tokens']['output']})",
        err=True,
    )

    payload = json.dumps(result, indent=2)
    if output is not None:
        output.write_text(payload + "\n", encoding="utf-8")
    else:
        typer.echo(payload)

    if failed:
        raise typer.Exit(1)


if __name__ == "__main__":
    app()

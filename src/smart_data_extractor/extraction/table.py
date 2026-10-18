"""Table mode: GLM-OCR's HTML table -> structured cells with confidence.

glm-ocr layout parsing returns ``label=table`` blocks as HTML. In table
mode that HTML is kept structurally (rows / cols / rowspan / colspan /
header flags) instead of being flattened to text, and every non-empty cell
is matched to the hand_write ``/files/ocr`` rows (see ocr.py) to get a box
and the row's ``min_prob`` as its confidence. No LLM call, no template.

A non-empty cell is flagged ``needs_review`` when it has no confidence or
the confidence is below ``REVIEW_THRESHOLD`` (mirrors the frontend's
CONFIDENCE_HIGH). Empty cells are never flagged.

Pure functions, no I/O.
"""

from html.parser import HTMLParser
from typing import Any

from smart_data_extractor.extraction.confidence_fusion import (
    _MIN_LINE_OVERLAP,
    _comparable,
    _overlap_ratio,
)
from smart_data_extractor.extraction.locate import (
    _is_valid_box,
    _normalize,
    normalize_boxes,
)

REVIEW_THRESHOLD = 0.85


class _TableParser(HTMLParser):
    """Collects the first <table>'s cells, resolving rowspan/colspan."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.cells: list[dict[str, Any]] = []
        self._occupied: set[tuple[int, int]] = set()
        self._row = -1
        self._col = 0
        self._current: dict[str, Any] | None = None
        self._depth = 0
        self._in_thead = False
        self._text: list[str] = []
        self._done = False

    @staticmethod
    def _span(attrs: list[tuple[str, str | None]], name: str) -> int:
        for key, value in attrs:
            if key == name:
                try:
                    return max(1, int(value or 1))
                except ValueError:
                    return 1
        return 1

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self._done:
            return
        if tag == "table":
            self._depth += 1
        elif self._depth != 1:
            return
        elif tag == "thead":
            self._in_thead = True
        elif tag == "tr":
            self._row += 1
            self._col = 0
        elif tag in ("td", "th") and self._row >= 0:
            while (self._row, self._col) in self._occupied:
                self._col += 1
            rowspan = self._span(attrs, "rowspan")
            colspan = self._span(attrs, "colspan")
            for r in range(self._row, self._row + rowspan):
                for c in range(self._col, self._col + colspan):
                    self._occupied.add((r, c))
            self._current = {
                "row": self._row,
                "col": self._col,
                "rowspan": rowspan,
                "colspan": colspan,
                "is_header": tag == "th" or self._in_thead,
            }
            self._text = []
            self._col += colspan

    def handle_endtag(self, tag: str) -> None:
        if self._done:
            return
        if tag == "table":
            self._depth -= 1
            if self._depth == 0:
                self._done = True
        elif self._depth != 1:
            return
        elif tag == "thead":
            self._in_thead = False
        elif tag in ("td", "th") and self._current is not None:
            self._current["text"] = " ".join("".join(self._text).split())
            self.cells.append(self._current)
            self._current = None

    def handle_data(self, data: str) -> None:
        if self._current is not None:
            self._text.append(data)


def parse_table_html(html: str) -> dict[str, Any] | None:
    """HTML table -> ``{rows, cols, cells}`` (each cell recorded once at its
    top-left position), or None when there is no table / no cells."""
    if not isinstance(html, str):
        return None
    parser = _TableParser()
    try:
        parser.feed(html)
        parser.close()
    except Exception:
        return None
    if not parser.cells:
        return None
    rows = max(c["row"] + c["rowspan"] for c in parser.cells)
    cols = max(c["col"] + c["colspan"] for c in parser.cells)
    return {"rows": rows, "cols": cols, "cells": parser.cells}


def _key(text: str) -> str:
    return _comparable(text) or _normalize(text)


def _union(boxes: list[list[float]]) -> list[float]:
    return [
        min(b[0] for b in boxes),
        min(b[1] for b in boxes),
        max(b[2] for b in boxes),
        max(b[3] for b in boxes),
    ]


def _match_cells(
    table: dict[str, Any], page: int, ocr_lines: list[dict[str, Any]] | None
) -> None:
    """Fill ``bbox``/``confidence`` on every non-empty cell, in place.

    Only lines on this page that mostly sit inside the table box are
    candidates. Cells are visited in document order; each line is consumed
    left to right via a per-line character cursor, so a line spanning
    several cells is split by character position and repeated texts map to
    successive lines. Per cell, three passes: (1) a line equal to the cell,
    (2) the cell as a substring of a line, (3) several lines whose texts
    concatenate to the cell.
    """
    lines = [
        line
        for line in (ocr_lines or [])
        if line.get("page") == page
        and isinstance(line.get("box"), list)
        and len(line["box"]) == 4
        and _overlap_ratio(line["box"], table["bbox"]) >= _MIN_LINE_OVERLAP
    ]
    keys = [_key(line.get("text") or "") for line in lines]
    cursor = [0] * len(lines)  # chars already consumed per line
    done = [False] * len(lines)  # line wholly used by a pass-1/3 match

    for cell in table["cells"]:
        cell.update(confidence=None, bbox=None, edited=False)
        key = _key(cell["text"])
        if not key:
            cell["needs_review"] = False
            continue

        box: list[float] | None = None
        confidence: float | None = None

        for i, line_key in enumerate(keys):
            if not done[i] and cursor[i] == 0 and line_key == key:
                done[i] = True
                box, confidence = list(lines[i]["box"]), lines[i]["min_prob"]
                break

        if box is None:
            for i, line_key in enumerate(keys):
                if done[i]:
                    continue
                pos = line_key.find(key, cursor[i])
                if pos < 0:
                    continue
                x1, y1, x2, y2 = lines[i]["box"]
                width = (x2 - x1) / len(line_key)
                box = [x1 + width * pos, y1, x1 + width * (pos + len(key)), y2]
                box = [round(v, 2) for v in box]
                confidence = lines[i]["min_prob"]
                cursor[i] = pos + len(key)
                break

        if box is None:
            picked: list[int] = []
            pos = 0
            for i, line_key in enumerate(keys):
                if done[i] or cursor[i] != 0 or not line_key:
                    continue
                if key.startswith(line_key, pos):
                    picked.append(i)
                    pos += len(line_key)
                    if pos == len(key):
                        break
            if picked and pos == len(key) and len(picked) > 1:
                for i in picked:
                    done[i] = True
                box = _union([lines[i]["box"] for i in picked])
                confidence = min(lines[i]["min_prob"] for i in picked)

        if box is not None:
            cell["bbox"] = {"page": page, "box": box}
            cell["confidence"] = confidence
        cell["needs_review"] = confidence is None or confidence < REVIEW_THRESHOLD


def extract_tables(
    layout_details: Any,
    pages_info: Any,
    ocr_lines: list[dict[str, Any]] | None,
    *,
    min_area: float,
) -> list[dict[str, Any]]:
    """All parseable tables of the document, or [] when no table block
    covers at least ``min_area`` (share, 0-1) of its page — the caller then
    stays in field-extraction mode.

    Each table: ``{page, bbox (0-100), rows, cols, cells[]}`` where a cell
    is ``{row, col, rowspan, colspan, text, is_header, confidence,
    bbox: {page, box} | None, needs_review, edited}``.
    """
    if not isinstance(layout_details, list):
        return []
    pages_info = pages_info if isinstance(pages_info, list) else []

    tables: list[dict[str, Any]] = []
    qualifies = False
    for page, page_details in enumerate(layout_details):
        if not isinstance(page_details, list):
            continue
        info = pages_info[page] if page < len(pages_info) else {}
        info = info if isinstance(info, dict) else {}
        for item in page_details:
            if not isinstance(item, dict) or item.get("label") != "table":
                continue
            raw_box = item.get("bbox_2d")
            if not _is_valid_box(raw_box):
                continue
            box = normalize_boxes(
                [[float(c) for c in raw_box]],
                width=info.get("width"),
                height=info.get("height"),
            )[0]
            parsed = parse_table_html(item.get("content"))
            if box is None or parsed is None:
                continue
            area = (box[2] - box[0]) * (box[3] - box[1]) / 10000.0
            qualifies = qualifies or area >= min_area
            table = {"page": page, "bbox": box, **parsed}
            _match_cells(table, page, ocr_lines)
            tables.append(table)
    return tables if qualifies else []

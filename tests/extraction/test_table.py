"""Tests for extraction.table: GLM-OCR HTML table -> structured cells with
hand_write confidence (table mode). Pure functions, no I/O."""

from smart_data_extractor.extraction.table import (
    extract_tables,
    parse_table_html,
)

_SIMPLE = (
    "<table><thead><tr><th>Name</th><th>Age</th></tr></thead>"
    "<tbody><tr><td>Alice</td><td>30</td></tr></tbody></table>"
)


def _line(text, box, min_prob=0.95, page=0):
    return {"page": page, "text": text, "box": box, "min_prob": min_prob}


def _layout(html, bbox=(0.0, 0.0, 1.0, 1.0)):
    return [[{"label": "table", "bbox_2d": list(bbox), "content": html}]]


# --- parse_table_html ---


def test_parse_simple_table_marks_header_cells():
    table = parse_table_html(_SIMPLE)
    assert table["rows"] == 2 and table["cols"] == 2
    texts = [(c["row"], c["col"], c["text"], c["is_header"]) for c in table["cells"]]
    assert texts == [
        (0, 0, "Name", True),
        (0, 1, "Age", True),
        (1, 0, "Alice", False),
        (1, 1, "30", False),
    ]


def test_parse_rowspan_colspan_records_cell_once_and_shifts_columns():
    html = (
        "<table><tr><th rowspan='2'>Item</th><th colspan='2'>Q1</th></tr>"
        "<tr><td>Jan</td><td>Feb</td></tr>"
        "<tr><td>Rent</td><td>1</td><td>2</td></tr></table>"
    )
    table = parse_table_html(html)
    assert table["rows"] == 3 and table["cols"] == 3
    by_pos = {(c["row"], c["col"]): c for c in table["cells"]}
    assert by_pos[(0, 0)]["rowspan"] == 2 and by_pos[(0, 0)]["colspan"] == 1
    assert by_pos[(0, 1)]["colspan"] == 2
    # row 1 is pushed right by the rowspan'd first column
    assert by_pos[(1, 1)]["text"] == "Jan" and by_pos[(1, 2)]["text"] == "Feb"
    assert len(table["cells"]) == 7


def test_parse_strips_inner_tags_and_whitespace_and_keeps_empty_cells():
    table = parse_table_html("<table><tr><td> <b>A</b>\n B </td><td></td></tr></table>")
    texts = [c["text"] for c in table["cells"]]
    assert texts == ["A B", ""]


def test_parse_returns_none_when_no_table_or_cells():
    assert parse_table_html("just text") is None
    assert parse_table_html("<table></table>") is None


# --- extract_tables: mode decision ---


def test_extract_tables_empty_when_no_table_block():
    layout = [[{"label": "text", "bbox_2d": [0, 0, 1, 1], "content": "hi"}]]
    assert extract_tables(layout, [], [], min_area=0.3) == []


def test_extract_tables_empty_when_table_below_min_area():
    layout = _layout(_SIMPLE, bbox=(0.0, 0.0, 0.3, 0.3))  # 9% of page
    assert extract_tables(layout, [], [], min_area=0.3) == []


def test_extract_tables_when_area_reaches_threshold_with_normalized_bbox():
    layout = _layout(_SIMPLE, bbox=(0.0, 0.0, 0.6, 0.6))  # 36%
    tables = extract_tables(layout, [], [], min_area=0.3)
    assert len(tables) == 1
    assert tables[0]["page"] == 0
    assert tables[0]["bbox"] == [0.0, 0.0, 60.0, 60.0]


def test_extract_tables_skips_unparseable_html():
    layout = _layout("<table></table>")
    assert extract_tables(layout, [], [], min_area=0.3) == []


def test_extract_tables_pixel_bbox_uses_page_dimensions():
    layout = _layout(_SIMPLE, bbox=(0, 0, 300, 400))
    tables = extract_tables(
        layout, [{"width": 600, "height": 800}], [], min_area=0.2
    )
    assert tables[0]["bbox"] == [0.0, 0.0, 50.0, 50.0]


# --- extract_tables: cell confidence matching ---


def _cells(tables):
    return {(c["row"], c["col"]): c for c in tables[0]["cells"]}


def test_cell_gets_box_and_confidence_of_matching_line():
    lines = [
        _line("Name", [0, 0, 40, 10], 0.99),
        _line("Age", [50, 0, 90, 10], 0.9),
        _line("Alice", [0, 20, 40, 30], 0.8),
        _line("30", [50, 20, 90, 30], 0.97),
    ]
    cells = _cells(extract_tables(_layout(_SIMPLE), [], lines, min_area=0.3))
    assert cells[(0, 0)]["confidence"] == 0.99
    assert cells[(1, 0)]["confidence"] == 0.8
    assert cells[(1, 0)]["bbox"] == {"page": 0, "box": [0, 20, 40, 30]}
    # below 0.85 -> review; above -> not
    assert cells[(1, 0)]["needs_review"] is True
    assert cells[(1, 1)]["needs_review"] is False
    assert cells[(1, 0)]["edited"] is False


def test_review_threshold_boundary_is_exclusive():
    html = "<table><tr><td>A</td><td>B</td></tr></table>"
    lines = [_line("A", [0, 0, 10, 10], 0.85), _line("B", [20, 0, 30, 10], 0.8499)]
    cells = _cells(extract_tables(_layout(html), [], lines, min_area=0.3))
    assert cells[(0, 0)]["needs_review"] is False
    assert cells[(0, 1)]["needs_review"] is True


def test_unmatched_non_empty_cell_has_no_confidence_and_needs_review():
    html = "<table><tr><td>Ghost</td><td></td></tr></table>"
    cells = _cells(extract_tables(_layout(html), [], [], min_area=0.3))
    assert cells[(0, 0)]["confidence"] is None
    assert cells[(0, 0)]["bbox"] is None
    assert cells[(0, 0)]["needs_review"] is True
    # empty cell: never flagged
    assert cells[(0, 1)]["needs_review"] is False
    assert cells[(0, 1)]["confidence"] is None


def test_ocr_lines_none_degrades_to_all_review():
    cells = _cells(extract_tables(_layout(_SIMPLE), [], None, min_area=0.3))
    assert all(c["needs_review"] for c in cells.values())


def test_line_covering_two_cells_is_split_by_character_position():
    html = "<table><tr><td>Alice</td><td>30</td></tr></table>"
    lines = [_line("Alice 30", [0, 0, 70, 10], 0.9)]
    cells = _cells(extract_tables(_layout(html), [], lines, min_area=0.3))
    first, second = cells[(0, 0)]["bbox"]["box"], cells[(0, 1)]["bbox"]["box"]
    assert first[0] == 0 and second[2] == 70
    assert first[2] <= second[0]
    assert cells[(0, 0)]["confidence"] == cells[(0, 1)]["confidence"] == 0.9


def test_multi_line_cell_unions_boxes_and_takes_min_confidence():
    html = "<table><tr><td>Hello World</td></tr></table>"
    lines = [_line("Hello", [0, 0, 20, 10], 0.95), _line("World", [0, 12, 20, 22], 0.7)]
    cell = _cells(extract_tables(_layout(html), [], lines, min_area=0.3))[(0, 0)]
    assert cell["bbox"]["box"] == [0, 0, 20, 22]
    assert cell["confidence"] == 0.7
    assert cell["needs_review"] is True


def test_lines_outside_table_or_on_other_pages_are_ignored():
    html = "<table><tr><td>Alice</td></tr></table>"
    layout = _layout(html, bbox=(0.0, 0.0, 0.5, 1.0))
    lines = [
        _line("Alice", [60, 0, 90, 10], 0.99),  # outside the table box
        _line("Alice", [0, 0, 20, 10], 0.99, page=1),  # other page
    ]
    cell = _cells(extract_tables(layout, [], lines, min_area=0.3))[(0, 0)]
    assert cell["confidence"] is None


def test_duplicate_texts_consume_lines_in_order():
    html = "<table><tr><td>1</td></tr><tr><td>1</td></tr></table>"
    lines = [_line("1", [0, 0, 10, 10], 0.99), _line("1", [0, 20, 10, 30], 0.6)]
    cells = _cells(extract_tables(_layout(html), [], lines, min_area=0.3))
    assert cells[(0, 0)]["confidence"] == 0.99
    assert cells[(1, 0)]["confidence"] == 0.6


def test_multiple_pages_each_table_gets_its_page_index():
    layout = _layout(_SIMPLE) + _layout(_SIMPLE)
    tables = extract_tables(layout, [], [], min_area=0.3)
    assert [t["page"] for t in tables] == [0, 1]

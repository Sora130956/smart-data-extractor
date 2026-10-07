"""Tests for the db layer: schema tables, session factory, init+seed."""

from smart_data_extractor.db import get_session_factory, init_db, reset_db_caches
from smart_data_extractor.db.models import SchemaDefinition, SchemaFieldRow


def test_init_db_creates_tables_and_seeds(test_db):
    session = get_session_factory()()
    try:
        defs = session.query(SchemaDefinition).all()
        assert {d.id for d in defs} == {"contact", "invoice", "lead"}
        assert all(d.is_builtin for d in defs)
        contact_fields = (
            session.query(SchemaFieldRow)
            .filter_by(schema_id="contact")
            .order_by(SchemaFieldRow.order)
            .all()
        )
        assert [f.field_name for f in contact_fields] == [
            "name", "email", "phone", "company", "job_title", "website",
        ]
        email = next(f for f in contact_fields if f.field_name == "email")
        assert email.format == "email"
        assert email.display_name_zh == "邮箱"
        assert email.display_name_en == "Email"
        assert email.description_zh == "联系人电子邮箱"
        assert email.description_en == "Email address of the contact"
    finally:
        session.close()


def test_seed_fields_have_bilingual_descriptions(test_db):
    """All 22 seeded fields carry both a Chinese and an English description."""
    session = get_session_factory()()
    try:
        rows = session.query(SchemaFieldRow).all()
        assert len(rows) == 22
        for f in rows:
            assert isinstance(f.description_zh, str) and f.description_zh.strip(), (
                f"{f.schema_id}.{f.field_name} has no Chinese description"
            )
            assert isinstance(f.description_en, str) and f.description_en.strip(), (
                f"{f.schema_id}.{f.field_name} has no English description"
            )
    finally:
        session.close()


def test_seed_specific_chinese_descriptions(test_db):
    """Spot-check representative Chinese descriptions per preset."""
    session = get_session_factory()()
    try:
        rows = {
            (f.schema_id, f.field_name): f.description_zh
            for f in session.query(SchemaFieldRow).all()
        }
        assert rows[("invoice", "date")] == "发票日期，ISO 格式（YYYY-MM-DD）"
        assert rows[("lead", "job_title")] == "线索联系人的职位（体现决策权）"
        assert rows[("lead", "timeline")] == "预计采购时间线（BANT：时间）"
        assert rows[("contact", "name")] == "联系人全名"
    finally:
        session.close()


def test_invoice_seed_has_no_line_items(test_db):
    session = get_session_factory()()
    try:
        names = {
            f.field_name
            for f in session.query(SchemaFieldRow).filter_by(schema_id="invoice")
        }
        assert "line_items" not in names
        assert names == {"invoice_number", "date", "vendor", "total", "tax", "currency"}
    finally:
        session.close()


def test_init_db_is_idempotent(test_db):
    init_db()  # second call must not duplicate rows
    session = get_session_factory()()
    try:
        assert session.query(SchemaDefinition).count() == 3
    finally:
        session.close()

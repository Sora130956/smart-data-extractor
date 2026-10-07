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

"""ORM models for schema storage (master/detail)."""

from datetime import datetime, timezone

from sqlalchemy import ForeignKey, UniqueConstraint
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class SchemaDefinition(Base):
    """Master table: one row per extraction schema (builtin or custom)."""

    __tablename__ = "schema_definitions"

    id: Mapped[str] = mapped_column(primary_key=True)
    display_name_zh: Mapped[str]
    display_name_en: Mapped[str]
    is_builtin: Mapped[bool] = mapped_column(default=False)
    prompt_template: Mapped[str | None]
    created_at: Mapped[datetime] = mapped_column(
        default=lambda: datetime.now(timezone.utc)
    )

    fields: Mapped[list["SchemaFieldRow"]] = relationship(
        back_populates="schema", cascade="all, delete-orphan"
    )


class SchemaFieldRow(Base):
    """Detail table: one row per field of a schema."""

    __tablename__ = "schema_fields"
    __table_args__ = (
        UniqueConstraint("schema_id", "field_name", name="uq_schema_field"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    schema_id: Mapped[str] = mapped_column(ForeignKey("schema_definitions.id"))
    field_name: Mapped[str]
    display_name_zh: Mapped[str]
    display_name_en: Mapped[str]
    type: Mapped[str]
    format: Mapped[str | None]
    description: Mapped[str | None]
    required: Mapped[bool] = mapped_column(default=False)
    order: Mapped[int]

    schema: Mapped[SchemaDefinition] = relationship(back_populates="fields")

"""Engine/session factories and database initialization."""

import os
from functools import lru_cache

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

DEFAULT_DATABASE_URL = "sqlite:///./smart_data_extractor.db"


@lru_cache
def get_engine():
    # Read the env var directly instead of get_settings(): the db layer must
    # work without OPENAI_API_KEY configured (acceptance suite AC-5).
    url = os.environ.get("DATABASE_URL", DEFAULT_DATABASE_URL)
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    return create_engine(url, connect_args=connect_args)


@lru_cache
def get_session_factory():
    return sessionmaker(bind=get_engine(), expire_on_commit=False)


def reset_db_caches() -> None:
    """Drop cached engine/session (tests swap DATABASE_URL per test)."""
    get_session_factory.cache_clear()
    get_engine.cache_clear()


def init_db() -> None:
    """Create tables and seed builtin presets when the DB is empty."""
    from smart_data_extractor.db.models import Base, SchemaDefinition
    from smart_data_extractor.db.seed import seed_builtin_presets

    Base.metadata.create_all(get_engine())
    session = get_session_factory()()
    try:
        if session.query(SchemaDefinition).count() == 0:
            seed_builtin_presets(session)
            session.commit()
    finally:
        session.close()

"""FastAPI entrypoint: app assembly.

Uvicorn target: ``smart_data_extractor.api:app``.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI

from smart_data_extractor.api.routes import router
from smart_data_extractor.db import init_db


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Deferred to startup: importing this module must not touch the
    # filesystem (ASGI test transports skip lifespan; tests use test_db).
    init_db()
    yield


def create_app() -> FastAPI:
    app = FastAPI(title="Smart Data Extractor", version="0.1.0", lifespan=lifespan)
    app.include_router(router)
    return app


app = create_app()

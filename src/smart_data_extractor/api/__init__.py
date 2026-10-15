"""FastAPI entrypoint: app assembly.

Uvicorn target: ``smart_data_extractor.api:app``.
"""

import logging
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from smart_data_extractor.api.routes import router
from smart_data_extractor.db import init_db

# Built SPA served by the API in single-service deployments (e.g. Render);
# absent in dev/tests where Vite serves the frontend separately.
FRONTEND_DIST = Path(__file__).resolve().parents[3] / "frontend" / "dist"


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Uvicorn only attaches handlers to its own "uvicorn.*" loggers, so app
    # INFO records (quota USAGE lines, feedback receipt) would otherwise be
    # dropped by the logging module's last-resort rule. One root handler
    # routes them to stderr -> the platform's log stream (Render). No-op in
    # tests (ASGITransport skips lifespan) and if something already
    # configured the root logger (basicConfig is idempotent that way).
    logging.basicConfig(level=logging.INFO)
    # Deferred to startup: importing this module must not touch the
    # filesystem (ASGI test transports skip lifespan; tests use test_db).
    init_db()
    yield


def create_app(dist_dir: Path | None = None) -> FastAPI:
    app = FastAPI(title="Smart Data Extractor", version="0.1.0", lifespan=lifespan)
    app.include_router(router)
    # Also served under /api/*: in dev, Vite's proxy strips that prefix
    # before forwarding (see vite.config.ts); single-service deploys have
    # no such proxy, so the app must accept the prefixed paths itself.
    app.include_router(router, prefix="/api")
    # Mounted after the API routers so /api/* and the bare paths both win
    # over the static mount; html=True serves the SPA entry at "/".
    dist = dist_dir if dist_dir is not None else FRONTEND_DIST
    if dist.is_dir():
        app.mount("/", StaticFiles(directory=dist, html=True), name="frontend")
    return app


app = create_app()

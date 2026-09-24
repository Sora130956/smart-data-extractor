"""FastAPI entrypoint: app assembly.

Uvicorn target: ``smart_data_extractor.api:app``.
"""

from fastapi import FastAPI

from smart_data_extractor.api.routes import router


def create_app() -> FastAPI:
    app = FastAPI(title="Smart Data Extractor", version="0.1.0")
    app.include_router(router)
    return app


app = create_app()

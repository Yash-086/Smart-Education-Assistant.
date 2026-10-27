from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from backend.app.core.config import get_settings
from backend.app.db.session import engine
from backend.app.api.tasks import router as tasks_router
from backend.app.api.academic import router as academic_router
from backend.app.api.study import router as study_router
from backend.app import models  # register all database models
from backend.app.db.session import Base

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    # Keeps a fresh local install usable; Alembic remains available for upgrades.
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)
app.include_router(tasks_router)
app.include_router(academic_router)
app.include_router(study_router)


@app.get("/api/health", tags=["system"])
def health_check() -> dict[str, str]:
    """Report API and database connectivity without requiring AI credentials."""
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
    return {"status": "ok", "database": "connected"}

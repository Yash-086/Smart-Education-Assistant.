from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Smart Education Assistant API"
    database_url: str = "sqlite:///./data/smart_education_assistant.db"
    llm_provider: str = "ollama"
    llm_base_url: str = Field(default="http://localhost:11434", min_length=1)
    llm_model: str = Field(default="llama3.2", min_length=1)
    # Optional credentials for the explicitly selected Hugging Face provider.
    hf_token: str | None = None
    hf_model: str = "openai/gpt-oss-120b"
    tavily_api_key: str | None = None
    llm_timeout_seconds: float = Field(default=60, gt=0, le=600)
    search_timeout_seconds: int = 12
    upload_dir: str = "./data/uploads"
    max_upload_bytes: int = 20 * 1024 * 1024

    @field_validator("llm_base_url", mode="before")
    @classmethod
    def default_blank_llm_base_url(cls, value):
        return value.strip() if isinstance(value, str) and value.strip() else "http://localhost:11434"

    @field_validator("llm_model", mode="before")
    @classmethod
    def default_blank_llm_model(cls, value):
        return value.strip() if isinstance(value, str) and value.strip() else "llama3.2"

    # Resolve the repo-root .env regardless of whether uvicorn starts from the
    # repository root or the backend directory. Process environment wins as usual.
    model_config = SettingsConfigDict(env_file=Path(__file__).resolve().parents[3] / ".env", extra="ignore")


@lru_cache
def get_settings() -> Settings:
    return Settings()

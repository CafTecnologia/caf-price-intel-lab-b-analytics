from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_env: str = "development"
    database_url: str = "sqlite:///./procurement.db"
    redis_url: str = "redis://localhost:6379/0"
    storage_root: Path = Path("./data/storage")
    default_currency: str = "COP"
    default_trm: float = 4200.0
    auto_create_schema: bool = True
    auth_users: str = "admin:admin123:administrator"

    llm_provider: str = "disabled"
    llm_base_url: str = "https://api.openai.com/v1"
    llm_api_key: str = ""
    llm_model: str = "gpt-4.1-mini"
    llm_timeout_seconds: int = 30
    llm_max_task_budget_usd: float = 2.5
    llm_max_process_budget_usd: float = 20.0
    llm_estimated_input_token_price: float = Field(default=0.0000005)
    llm_estimated_output_token_price: float = Field(default=0.0000015)

    benchmark_import_factor: float = 0.30
    benchmark_cache_ttl_seconds: int = 86400
    celery_task_always_eager: bool = False


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    settings = Settings()
    settings.storage_root.mkdir(parents=True, exist_ok=True)
    return settings


from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from procurement_api.services import get_provider_config, run_provider_connection_test, save_provider_config
from procurement_core.db.base import Base
from procurement_core.models.enums import ProviderKind
from procurement_core.schemas.provider import ProviderConfigUpsert


def test_can_persist_llm_provider_config() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        saved = save_provider_config(
            session,
            ProviderConfigUpsert(
                provider_name=ProviderKind.OPENAI_COMPATIBLE,
                base_url="https://api.deepseek.com/v1",
                model_name="deepseek-chat",
                api_key="sk-demo-1234",
                enabled=True,
            ),
        )
        session.commit()
        loaded = get_provider_config(session)

        assert saved.provider_name == ProviderKind.OPENAI_COMPATIBLE
        assert loaded.base_url == "https://api.deepseek.com/v1"
        assert loaded.has_api_key is True
        assert loaded.api_key_masked is not None


def test_disabled_provider_test_returns_failure_without_network() -> None:
    engine = create_engine("sqlite:///:memory:", future=True)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        result = run_provider_connection_test(
            session,
            ProviderConfigUpsert(
                provider_name=ProviderKind.DISABLED,
                base_url="",
                model_name="disabled",
                api_key="",
                enabled=False,
            ),
        )

        assert result.succeeded is False
        assert result.error_message == "LLM provider disabled"

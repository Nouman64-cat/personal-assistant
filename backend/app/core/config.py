from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    PROJECT_NAME: str = "Personal Assistant API"
    API_V1_PREFIX: str = "/api/v1"
    DATABASE_URL: str = "sqlite:///./app.db"
    CORS_ORIGINS: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://1b34-116-58-40-146.ngrok-free.app",
    ]

    # Read from the process environment (or .env) at startup; never hardcode.
    OPENAI_API_KEY: str | None = None
    OPENAI_MODEL: str = "gpt-4o-mini"
    OPENAI_REQUEST_TIMEOUT_SECONDS: float = 30.0
    CHAT_MAX_TOOL_ROUNDTRIPS: int = 5

    # Voice: Deepgram is the primary STT/TTS provider (faster, cheaper);
    # OpenAI is the fallback whenever Deepgram is unset or a call to it
    # fails. See app/services/voice_service.py.
    DEEPGRAM_API_KEY: str | None = None
    DEEPGRAM_REQUEST_TIMEOUT_SECONDS: float = 15.0


settings = Settings()

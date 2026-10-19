from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="APP_")

    data_dir: Path = Path("/data")
    static_dir: Path = Path("/app/static")
    # Часовой пояс по умолчанию, если браузер создателя события его не передал.
    timezone: str = "Europe/Moscow"
    code_ttl_days: int = 7
    # Событие и его музыка удаляются, если в него никто не заходил столько дней.
    inactive_event_ttl_days: int = 7
    max_upload_mb: int = 300
    tick_interval: float = 0.25

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.data_dir / 'app.db'}"

    @property
    def music_dir(self) -> Path:
        return self.data_dir / "music"


settings = Settings()

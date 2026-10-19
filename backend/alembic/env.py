from logging.config import fileConfig

from alembic import context

from app import models  # noqa: F401  — регистрирует таблицы в metadata
from app.config import settings
from app.db import Base, engine

config = context.config
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

settings.data_dir.mkdir(parents=True, exist_ok=True)

with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()

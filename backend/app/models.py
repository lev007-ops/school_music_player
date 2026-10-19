from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, Date, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Event(Base):
    __tablename__ = "events"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(200))
    date: Mapped[dt.date] = mapped_column(Date)
    # IANA-зона, в которой заданы дата события и время перемен.
    timezone: Mapped[str] = mapped_column(String(64))
    code: Mapped[str] = mapped_column(String(6), index=True)
    code_expires_at: Mapped[float] = mapped_column(Float)
    admin_password_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[float] = mapped_column(Float)
    # Последний вход в событие (админ или устройство). Неактивные события удаляются.
    last_activity_at: Mapped[float] = mapped_column(Float, index=True)

    # Состояние плеера (единственный источник истины — сервер)
    mode: Mapped[str] = mapped_column(String(8), default="auto")  # auto | on | off
    repeat_mode: Mapped[str] = mapped_column(String(8), default="all")  # all | one | off
    paused: Mapped[bool] = mapped_column(Boolean, default=False)
    current_track_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Момент (unix time сервера), когда у текущего трека была позиция 0. None — не играет.
    started_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Позиция, с которой продолжить, когда трек не играет.
    position: Mapped[float] = mapped_column(Float, default=0.0)
    # Режим «без повтора»: очередь доиграна, ждём следующей перемены.
    queue_ended: Mapped[bool] = mapped_column(Boolean, default=False)

    tracks: Mapped[list[Track]] = relationship(
        back_populates="event", cascade="all, delete-orphan", order_by="Track.position"
    )
    breaks: Mapped[list[Break]] = relationship(cascade="all, delete-orphan", order_by="Break.start")
    devices: Mapped[list[Device]] = relationship(cascade="all, delete-orphan", order_by="Device.created_at")
    admin_sessions: Mapped[list[AdminSession]] = relationship(cascade="all, delete-orphan")


class Track(Base):
    __tablename__ = "tracks"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(300))
    artist: Mapped[str] = mapped_column(String(300), default="")
    original_name: Mapped[str] = mapped_column(String(300))
    file_name: Mapped[str] = mapped_column(String(100))
    mime_type: Mapped[str] = mapped_column(String(100))
    size: Mapped[int] = mapped_column(Integer)
    duration: Mapped[float] = mapped_column(Float)
    position: Mapped[int] = mapped_column(Integer)
    loop: Mapped[bool] = mapped_column(Boolean, default=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[float] = mapped_column(Float)

    event: Mapped[Event] = relationship(back_populates="tracks")


class Break(Base):
    __tablename__ = "breaks"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    start: Mapped[str] = mapped_column(String(5))  # HH:MM
    end: Mapped[str] = mapped_column(String(5))


class Device(Base):
    __tablename__ = "devices"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(100))
    user_agent: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[float] = mapped_column(Float)
    last_seen_at: Mapped[float] = mapped_column(Float)


class AdminSession(Base):
    __tablename__ = "admin_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    event_id: Mapped[int] = mapped_column(ForeignKey("events.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    created_at: Mapped[float] = mapped_column(Float)

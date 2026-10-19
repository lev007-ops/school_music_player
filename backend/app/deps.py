from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import get_db
from .models import AdminSession, Device, Event
from .security import get_token, hash_secret


@dataclass
class TokenCtx:
    kind: str  # admin | device
    event_id: int
    device_id: int | None = None


def resolve_token(db: Session, token: str | None) -> TokenCtx | None:
    if not token:
        return None
    h = hash_secret(token)
    sess = db.scalar(select(AdminSession).where(AdminSession.token_hash == h))
    if sess is not None:
        return TokenCtx("admin", sess.event_id)
    dev = db.scalar(select(Device).where(Device.token_hash == h))
    if dev is not None:
        return TokenCtx("device", dev.event_id, dev.id)
    return None


async def any_ctx(request: Request, db: Session = Depends(get_db)) -> TokenCtx:
    ctx = resolve_token(db, get_token(request))
    if ctx is None:
        raise HTTPException(401, "Нет доступа к событию")
    return ctx


async def admin_event(request: Request, db: Session = Depends(get_db)) -> Event:
    ctx = resolve_token(db, get_token(request))
    if ctx is None or ctx.kind != "admin":
        raise HTTPException(401, "Сессия администратора недействительна")
    ev = db.get(Event, ctx.event_id)
    if ev is None:
        raise HTTPException(404, "Событие не найдено")
    return ev


async def device_ctx(request: Request, db: Session = Depends(get_db)) -> Device:
    ctx = resolve_token(db, get_token(request))
    if ctx is None or ctx.kind != "device":
        raise HTTPException(401, "Устройство не подключено к событию")
    dev = db.get(Device, ctx.device_id)
    if dev is None:
        raise HTTPException(401, "Устройство не подключено к событию")
    return dev

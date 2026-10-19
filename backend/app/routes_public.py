import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from . import engine
from .config import settings
from .db import get_db
from .deps import TokenCtx, any_ctx, device_ctx
from .hub import hub
from .models import AdminSession, Break, Device, Event, Track
from .schedule import ScheduleError, parse_schedule
from .schemas import CreateEventIn, CreateEventOut, DeviceMe, EventBrief, JoinIn, JoinOut, LoginIn, LoginOut
from .security import (
    client_ip,
    create_limiter,
    hash_secret,
    join_limiter,
    login_limiter,
    new_code,
    new_password,
    new_token,
)

router = APIRouter()


def generate_unique_code(db: Session, now: float, exclude_event: int | None = None) -> str:
    for _ in range(100):
        code = new_code()
        clash = db.scalar(
            select(Event.id).where(Event.code == code, Event.code_expires_at > now, Event.id != (exclude_event or 0))
        )
        if clash is None:
            return code
    raise HTTPException(503, "Не удалось сгенерировать код, попробуйте ещё раз")


def brief(ev: Event) -> EventBrief:
    return EventBrief(id=ev.id, name=ev.name, date=ev.date)


@router.post("/events", response_model=CreateEventOut)
async def create_event(body: CreateEventIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    create_limiter.check(ip)
    try:
        breaks = parse_schedule(body.schedule_text)
    except ScheduleError as e:
        raise HTTPException(400, str(e))
    tz_name = body.timezone or settings.timezone
    if not engine.is_valid_timezone(tz_name):
        tz_name = settings.timezone
    create_limiter.hit(ip)

    now = time.time()
    password = new_password()
    ev = Event(
        name=body.name.strip(),
        date=body.date,
        timezone=tz_name,
        code=generate_unique_code(db, now),
        code_expires_at=now + settings.code_ttl_days * 86400,
        admin_password_hash=hash_secret(password),
        created_at=now,
        last_activity_at=now,
        mode="auto",
        repeat_mode="all",
        paused=False,
        position=0.0,
        queue_ended=False,
    )
    ev.breaks = [Break(start=s, end=e) for s, e in breaks]
    db.add(ev)
    db.flush()
    token = new_token()
    db.add(AdminSession(event_id=ev.id, token_hash=hash_secret(token), created_at=now))
    db.commit()
    return CreateEventOut(
        event_id=ev.id,
        code=ev.code,
        code_expires_at=ev.code_expires_at,
        admin_password=password,
        admin_token=token,
    )


@router.post("/admin/login", response_model=LoginOut)
async def admin_login(body: LoginIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    login_limiter.check(ip)
    ev = db.scalar(select(Event).where(Event.admin_password_hash == hash_secret(body.password.strip())))
    if ev is None:
        login_limiter.hit(ip)
        raise HTTPException(401, "Неверный пароль администратора")
    token = new_token()
    ev.last_activity_at = time.time()
    db.add(AdminSession(event_id=ev.id, token_hash=hash_secret(token), created_at=ev.last_activity_at))
    db.commit()
    return LoginOut(admin_token=token, event_id=ev.id, event_name=ev.name)


@router.post("/join", response_model=JoinOut)
async def join(body: JoinIn, request: Request, db: Session = Depends(get_db)):
    ip = client_ip(request)
    join_limiter.check(ip)
    now = time.time()
    ev = db.scalar(select(Event).where(Event.code == body.code, Event.code_expires_at > now))
    if ev is None:
        join_limiter.hit(ip)
        raise HTTPException(404, "Код не найден или срок его действия истёк")
    token = new_token()
    ua = request.headers.get("user-agent", "")[:500]
    dev = Device(
        event_id=ev.id,
        token_hash=hash_secret(token),
        name=(body.name.strip() or "Устройство")[:100],
        user_agent=ua,
        created_at=now,
        last_seen_at=now,
    )
    db.add(dev)
    ev.last_activity_at = now
    db.commit()
    hub.mark_devices_dirty(ev.id)
    return JoinOut(device_token=token, device_id=dev.id, event=brief(ev))


@router.get("/device/me", response_model=DeviceMe)
async def device_me(dev: Device = Depends(device_ctx), db: Session = Depends(get_db)):
    ev = db.get(Event, dev.event_id)
    return DeviceMe(device_id=dev.id, name=dev.name, event=brief(ev))


@router.delete("/device/me", status_code=204)
async def device_leave(dev: Device = Depends(device_ctx), db: Session = Depends(get_db)):
    event_id, device_id = dev.event_id, dev.id
    db.delete(dev)
    db.commit()
    await hub.close_device(event_id, device_id, 4001, "left")
    hub.mark_devices_dirty(event_id)


@router.get("/tracks/{track_id}/audio")
async def track_audio(track_id: int, ctx: TokenCtx = Depends(any_ctx), db: Session = Depends(get_db)):
    track = db.get(Track, track_id)
    if track is None or track.event_id != ctx.event_id:
        raise HTTPException(404, "Трек не найден")
    path = settings.music_dir / str(track.event_id) / track.file_name
    if not path.is_file():
        raise HTTPException(404, "Файл трека отсутствует на сервере")
    return FileResponse(
        path,
        media_type=track.mime_type,
        headers={"Cache-Control": "private, max-age=31536000, immutable"},
    )


@router.get("/time")
async def server_time():
    return {"server_time": time.time()}



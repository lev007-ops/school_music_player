import asyncio
import datetime as dt
import logging
import shutil
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.orm import selectinload

from . import engine
from .config import settings
from .db import SessionLocal
from .hub import hub
from .models import Event
from .routes_admin import router as admin_router
from .routes_public import router as public_router
from .routes_ws import router as ws_router

log = logging.getLogger("music")


def _tick(ts: float) -> list[Event]:
    """Синхронно продвигает все актуальные события. Возвращает события с подключёнными клиентами."""
    yesterday = dt.datetime.fromtimestamp(ts, dt.UTC).date() - dt.timedelta(days=1)
    with SessionLocal() as db:
        events = db.scalars(
            select(Event)
            .where(
                or_(
                    Event.date >= yesterday,
                    Event.mode == "on",
                    Event.started_at.is_not(None),
                    Event.id.in_(list(hub.conns)),
                )
            )
            .options(selectinload(Event.tracks), selectinload(Event.breaks))
        ).all()
        changed = False
        for ev in events:
            changed |= engine.step(ev, ts)
        if changed:
            db.commit()
        return [ev for ev in events if ev.id in hub.conns]


async def player_loop() -> None:
    while True:
        try:
            ts = time.time()
            for ev in _tick(ts):
                await hub.push_state(ev, ts, only_if_changed=True)
            await hub.flush_devices()
        except Exception:
            log.exception("player loop error")
        await asyncio.sleep(settings.tick_interval)


def _cleanup_inactive(ts: float) -> list[int]:
    border = ts - settings.inactive_event_ttl_days * 86400
    with SessionLocal() as db:
        stale = db.scalars(
            select(Event).where(Event.last_activity_at < border, Event.id.not_in(list(hub.conns)))
        ).all()
        ids = [ev.id for ev in stale]
        for ev in stale:
            db.delete(ev)
        db.commit()
    for event_id in ids:
        shutil.rmtree(settings.music_dir / str(event_id), ignore_errors=True)
    return ids


async def cleanup_loop() -> None:
    while True:
        try:
            ts = time.time()
            # Пока к событию кто-то подключён, оно считается активным.
            if hub.conns:
                with SessionLocal() as db:
                    for ev in db.scalars(select(Event).where(Event.id.in_(list(hub.conns)))):
                        ev.last_activity_at = ts
                    db.commit()
            for event_id in _cleanup_inactive(ts):
                log.info("deleted inactive event %s", event_id)
        except Exception:
            log.exception("cleanup error")
        await asyncio.sleep(600)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    settings.music_dir.mkdir(parents=True, exist_ok=True)
    tasks = [asyncio.create_task(player_loop()), asyncio.create_task(cleanup_loop())]
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(
    title="Школьная музыка",
    description="Автор: Барях Лев, ученик 10А класса школы № 9 г. Пермь",
    lifespan=lifespan,
)
app.include_router(public_router, prefix="/api")
app.include_router(admin_router, prefix="/api")
app.include_router(ws_router, prefix="/api")


@app.get("/api/{path:path}", include_in_schema=False)
async def api_not_found(path: str):
    raise HTTPException(404, "Not found")


@app.get("/{path:path}", include_in_schema=False)
async def spa(path: str):
    static = settings.static_dir.resolve()
    target = (static / path).resolve()
    if path and target.is_relative_to(static) and target.is_file():
        cache = "public, max-age=31536000, immutable" if path.startswith("assets/") else "no-cache"
        return FileResponse(target, headers={"Cache-Control": cache})
    index = static / "index.html"
    if not index.is_file():
        raise HTTPException(404, "Frontend is not built")
    return FileResponse(index, headers={"Cache-Control": "no-cache"})

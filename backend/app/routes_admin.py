import mimetypes
import random
import shutil
import time
import uuid
from collections.abc import Callable
from pathlib import Path

import mutagen
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import PlainTextResponse
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import engine
from .config import settings
from .db import get_db
from .deps import admin_event
from .hub import hub
from .models import Break, Device, Event, Track
from .routes_public import generate_unique_code
from .schedule import ScheduleError, format_schedule, normalize_breaks, parse_schedule
from .schemas import (
    EventInfo,
    EventPatch,
    JumpIn,
    MoveNextIn,
    PlayerPatch,
    ScheduleIn,
    ScheduleOut,
    SeekIn,
    TrackOrder,
    TrackPatch,
)

router = APIRouter(prefix="/admin")

AUDIO_EXTENSIONS = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".webm": "audio/webm",
}


async def apply(db: Session, ev: Event, action: Callable[[Event, float], None] | None = None) -> None:
    """Атомарно (без await внутри) применяет команду, продвигает плеер и рассылает состояние."""
    db.refresh(ev)
    ts = time.time()
    if action is not None:
        action(ev, ts)
    engine.step(ev, ts)
    db.commit()
    await hub.push_state(ev, ts)


def event_info(ev: Event) -> EventInfo:
    return EventInfo(
        id=ev.id,
        name=ev.name,
        date=ev.date,
        code=ev.code,
        code_expires_at=ev.code_expires_at,
        code_expired=ev.code_expires_at <= time.time(),
        created_at=ev.created_at,
        timezone=ev.timezone,
    )


def get_event_track(db: Session, ev: Event, track_id: int) -> Track:
    track = db.get(Track, track_id)
    if track is None or track.event_id != ev.id:
        raise HTTPException(404, "Трек не найден")
    return track


# ---- Событие ----

@router.get("/event", response_model=EventInfo)
async def get_event(ev: Event = Depends(admin_event)):
    return event_info(ev)


@router.patch("/event", response_model=EventInfo)
async def patch_event(body: EventPatch, ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    if body.timezone is not None and not engine.is_valid_timezone(body.timezone):
        raise HTTPException(400, f"Неизвестный часовой пояс: {body.timezone}")

    def action(e: Event, ts: float) -> None:
        if body.name is not None:
            e.name = body.name.strip()
        if body.date is not None:
            e.date = body.date
        if body.timezone is not None:
            e.timezone = body.timezone

    await apply(db, ev, action)
    return event_info(ev)


@router.delete("/event", status_code=204)
async def delete_event(ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    event_id = ev.id
    db.delete(ev)
    db.commit()
    shutil.rmtree(settings.music_dir / str(event_id), ignore_errors=True)
    await hub.close_event(event_id, 4004, "deleted")


@router.post("/code/regenerate", response_model=EventInfo)
async def regenerate_code(ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    now = time.time()
    ev.code = generate_unique_code(db, now, exclude_event=ev.id)
    ev.code_expires_at = now + settings.code_ttl_days * 86400
    db.commit()
    return event_info(ev)


@router.post("/logout", status_code=204)
async def logout():
    # Токен хранится только в браузере; сессия остаётся валидной на других устройствах.
    return None


@router.get("/timezones")
async def timezones(ev: Event = Depends(admin_event)):
    return sorted(z for z in engine.all_timezones() if "/" in z and not z.startswith(("Etc/", "SystemV/", "posix/", "right/")))


# ---- Треки ----

def read_audio_meta(path: Path, original_name: str) -> tuple[float, str, str]:
    try:
        audio = mutagen.File(path)
    except Exception:
        audio = None
    if audio is None or not getattr(audio, "info", None) or not getattr(audio.info, "length", 0):
        raise HTTPException(400, f"«{original_name}»: не удалось прочитать аудиофайл")
    title, artist = Path(original_name).stem, ""
    try:
        tags = mutagen.File(path, easy=True)
        if tags is not None and tags.tags:
            t = (tags.get("title") or [""])[0].strip()
            if t:
                title = t
                artist = (tags.get("artist") or [""])[0].strip()
    except Exception:
        pass
    return float(audio.info.length), title[:300], artist[:300]


@router.post("/tracks")
async def upload_track(file: UploadFile = File(...), ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    original = Path(file.filename or "track").name[:300]
    ext = Path(original).suffix.lower()
    if ext not in AUDIO_EXTENSIONS:
        raise HTTPException(400, f"«{original}»: неподдерживаемый формат. Допустимы: {', '.join(AUDIO_EXTENSIONS)}")

    folder = settings.music_dir / str(ev.id)
    folder.mkdir(parents=True, exist_ok=True)
    file_name = f"{uuid.uuid4().hex}{ext}"
    path = folder / file_name
    limit = settings.max_upload_mb * 1024 * 1024
    size = 0
    try:
        with path.open("wb") as out:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > limit:
                    raise HTTPException(413, f"«{original}»: файл больше {settings.max_upload_mb} МБ")
                out.write(chunk)
        duration, title, artist = read_audio_meta(path, original)
    except BaseException:
        path.unlink(missing_ok=True)
        raise

    db.refresh(ev)
    max_pos = db.scalar(select(func.max(Track.position)).where(Track.event_id == ev.id))
    track = Track(
        event_id=ev.id,
        title=title,
        artist=artist,
        original_name=original,
        file_name=file_name,
        mime_type=AUDIO_EXTENSIONS[ext] or mimetypes.guess_type(original)[0] or "application/octet-stream",
        size=size,
        duration=duration,
        position=(max_pos or 0) + 1,
        loop=False,
        enabled=True,
        created_at=time.time(),
    )
    db.add(track)
    db.flush()
    await apply(db, ev)
    return engine.track_dict(track)


@router.patch("/tracks/{track_id}")
async def patch_track(track_id: int, body: TrackPatch, ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    track = get_event_track(db, ev, track_id)

    def action(e: Event, ts: float) -> None:
        if body.title is not None:
            track.title = body.title.strip()
        if body.artist is not None:
            track.artist = body.artist.strip()
        if body.loop is not None:
            track.loop = body.loop
        if body.enabled is not None and body.enabled != track.enabled:
            if not body.enabled:
                engine.before_track_removed(e, track, ts)
            track.enabled = body.enabled

    await apply(db, ev, action)
    return engine.track_dict(track)


@router.delete("/tracks/{track_id}", status_code=204)
async def delete_track(track_id: int, ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    track = get_event_track(db, ev, track_id)
    path = settings.music_dir / str(ev.id) / track.file_name

    def action(e: Event, ts: float) -> None:
        engine.before_track_removed(e, track, ts)
        e.tracks.remove(track)

    await apply(db, ev, action)
    path.unlink(missing_ok=True)


@router.put("/tracks/order", status_code=204)
async def reorder_tracks(body: TrackOrder, ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    def action(e: Event, ts: float) -> None:
        by_id = {t.id: t for t in e.tracks}
        if sorted(body.ids) != sorted(by_id):
            raise HTTPException(400, "Список треков устарел, обновите страницу")
        for i, tid in enumerate(body.ids, 1):
            by_id[tid].position = i

    await apply(db, ev, action)


@router.post("/tracks/shuffle", status_code=204)
async def shuffle_tracks(ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    def action(e: Event, ts: float) -> None:
        tracks = engine.ordered(e)
        # Текущий трек оставляем первым, остальные перемешиваем.
        current = [t for t in tracks if t.id == e.current_track_id]
        rest = [t for t in tracks if t.id != e.current_track_id]
        random.shuffle(rest)
        for i, t in enumerate(current + rest, 1):
            t.position = i

    await apply(db, ev, action)


@router.post("/tracks/play-next", status_code=204)
async def play_next(body: MoveNextIn, ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    track = get_event_track(db, ev, body.track_id)

    def action(e: Event, ts: float) -> None:
        tracks = [t for t in engine.ordered(e) if t.id != track.id]
        idx = next((i for i, t in enumerate(tracks) if t.id == e.current_track_id), -1)
        tracks.insert(idx + 1, track)
        track.enabled = True
        for i, t in enumerate(tracks, 1):
            t.position = i

    await apply(db, ev, action)


# ---- Плеер ----

@router.post("/player/play", status_code=204)
async def player_play(ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    await apply(db, ev, engine.op_play)


@router.post("/player/pause", status_code=204)
async def player_pause(ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    await apply(db, ev, engine.op_pause)


@router.post("/player/next", status_code=204)
async def player_next(ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    await apply(db, ev, engine.op_next)


@router.post("/player/prev", status_code=204)
async def player_prev(ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    await apply(db, ev, engine.op_prev)


@router.post("/player/jump", status_code=204)
async def player_jump(body: JumpIn, ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    track = get_event_track(db, ev, body.track_id)
    if not track.enabled:
        track.enabled = True
    await apply(db, ev, lambda e, ts: engine.op_jump(e, track, ts))


@router.post("/player/seek", status_code=204)
async def player_seek(body: SeekIn, ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    await apply(db, ev, lambda e, ts: engine.op_seek(e, body.position, ts))


@router.patch("/player", status_code=204)
async def player_patch(body: PlayerPatch, ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    def action(e: Event, ts: float) -> None:
        if body.mode is not None:
            e.mode = body.mode
        if body.repeat_mode is not None:
            e.repeat_mode = body.repeat_mode
            e.queue_ended = False

    await apply(db, ev, action)


# ---- Расписание ----

def set_breaks(db: Session, ev: Event, items: list[tuple[str, str]]) -> None:
    ev.breaks.clear()
    db.flush()
    ev.breaks.extend(Break(start=s, end=e) for s, e in items)


def schedule_out(ev: Event) -> ScheduleOut:
    return ScheduleOut(breaks=[{"start": b.start, "end": b.end} for b in sorted(ev.breaks, key=lambda b: b.start)])


@router.get("/schedule", response_model=ScheduleOut)
async def get_schedule(ev: Event = Depends(admin_event)):
    return schedule_out(ev)


@router.put("/schedule", response_model=ScheduleOut)
async def put_schedule(body: ScheduleIn, ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    try:
        items = normalize_breaks([(b.start, b.end) for b in body.breaks])
    except ScheduleError as e:
        raise HTTPException(400, str(e))
    await apply(db, ev, lambda e, ts: set_breaks(db, e, items))
    return schedule_out(ev)


@router.post("/schedule/import", response_model=ScheduleOut)
async def import_schedule(file: UploadFile = File(...), ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    raw = await file.read(200_000)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        text = raw.decode("cp1251", errors="replace")
    try:
        items = parse_schedule(text)
    except ScheduleError as e:
        raise HTTPException(400, str(e))
    await apply(db, ev, lambda e, ts: set_breaks(db, e, items))
    return schedule_out(ev)


@router.get("/schedule/export", response_class=PlainTextResponse)
async def export_schedule(ev: Event = Depends(admin_event)):
    text = format_schedule([(b.start, b.end) for b in sorted(ev.breaks, key=lambda b: b.start)])
    return PlainTextResponse(
        text,
        headers={"Content-Disposition": 'attachment; filename="schedule.txt"'},
        media_type="text/plain; charset=utf-8",
    )


# ---- Устройства ----

@router.get("/devices")
async def list_devices(ev: Event = Depends(admin_event)):
    return hub.devices_list(ev.id)


@router.delete("/devices/{device_id}", status_code=204)
async def remove_device(device_id: int, ev: Event = Depends(admin_event), db: Session = Depends(get_db)):
    dev = db.get(Device, device_id)
    if dev is None or dev.event_id != ev.id:
        raise HTTPException(404, "Устройство не найдено")
    db.delete(dev)
    db.commit()
    await hub.close_device(ev.id, device_id, 4001, "removed")
    hub.mark_devices_dirty(ev.id)

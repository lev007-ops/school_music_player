"""Логика воспроизведения. Все функции чистые относительно времени: принимают ts (unix time)."""

import datetime as dt
from functools import lru_cache
from zoneinfo import ZoneInfo, available_timezones

from .config import settings
from .models import Event, Track



@lru_cache(maxsize=1)
def all_timezones() -> frozenset[str]:
    return frozenset(available_timezones())


def is_valid_timezone(name: str) -> bool:
    return name in all_timezones()


@lru_cache(maxsize=256)
def zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except Exception:
        return ZoneInfo(settings.timezone)

RESTART_THRESHOLD = 3.0  # «назад» дальше этой позиции перезапускает текущий трек


def ordered(ev: Event) -> list[Track]:
    return sorted(ev.tracks, key=lambda t: (t.position, t.id))


def playable(ev: Event) -> list[Track]:
    return [t for t in ordered(ev) if t.enabled and t.duration > 0]


def get_track(ev: Event, track_id: int | None) -> Track | None:
    return next((t for t in ev.tracks if t.id == track_id), None)


def _epoch(day: dt.date, hm: str, tz: ZoneInfo) -> float:
    return dt.datetime.combine(day, dt.time.fromisoformat(hm), tz).timestamp()


def find_window(ev: Event, ts: float) -> tuple[bool, float | None, float | None]:
    """(музыка должна звучать, конец текущей перемены, начало следующей перемены)."""
    if ev.mode == "on":
        return True, None, None
    if ev.mode == "off":
        return False, None, None
    tz = zone(ev.timezone)
    today = dt.datetime.fromtimestamp(ts, tz).date()
    if ev.date < today:
        return False, None, None
    for b in sorted(ev.breaks, key=lambda b: b.start):
        start, end = _epoch(ev.date, b.start, tz), _epoch(ev.date, b.end, tz)
        if start <= ts < end:
            return True, end, None
        if ts < start:
            return False, None, start
    return False, None, None


def current_position(ev: Event, ts: float) -> float:
    return ts - ev.started_at if ev.started_at is not None else ev.position


def _neighbor(ev: Event, current: Track | None, step: int, wrap: bool = True) -> Track | None:
    tracks = playable(ev)
    if not tracks:
        return None
    if current is None:
        return tracks[0] if step > 0 else tracks[-1]
    ids = [t.id for t in tracks]
    if current.id in ids:
        i = ids.index(current.id) + step
    else:
        # Текущий трек выключен/удалён — ищем соседа по позиции в общей очереди.
        after = [i for i, t in enumerate(tracks) if (t.position, t.id) > (current.position, current.id)]
        i = (after[0] if after else len(tracks)) if step > 0 else (after[0] if after else len(tracks)) - 1
    if 0 <= i < len(tracks):
        return tracks[i]
    return tracks[i % len(tracks)] if wrap else None


def auto_next(ev: Event, current: Track | None) -> Track | None:
    """Что играет после естественного окончания трека."""
    if current is not None and current.enabled and (current.loop or ev.repeat_mode == "one"):
        return current
    return _neighbor(ev, current, 1, wrap=ev.repeat_mode == "all")


def _switch(ev: Event, track: Track | None, ts: float) -> None:
    running = ev.started_at is not None
    ev.current_track_id = track.id if track else None
    ev.position = 0.0
    ev.queue_ended = False
    ev.started_at = ts if running and track else None


def step(ev: Event, ts: float) -> bool:
    """Продвигает состояние плеера к моменту ts. Возвращает True, если что-то изменилось."""
    before = (ev.current_track_id, ev.started_at, ev.position, ev.queue_ended)
    window, _, _ = find_window(ev, ts)
    tracks = playable(ev)
    cur = get_track(ev, ev.current_track_id)

    if not window and ev.queue_ended:
        ev.queue_ended = False
    if cur is not None and not (cur.enabled and cur.duration > 0):
        cur = _neighbor(ev, cur, 1)
        ev.current_track_id = cur.id if cur else None
        ev.position = 0.0
        if ev.started_at is not None:
            ev.started_at = ts if cur else None

    should_play = window and not ev.paused and bool(tracks) and not ev.queue_ended
    if should_play:
        if cur is None:
            cur = tracks[0]
            ev.current_track_id = cur.id
            ev.position = 0.0
        if ev.started_at is None:
            ev.started_at = ts - min(ev.position, max(cur.duration - 1, 0))
        else:
            end = ev.started_at + cur.duration
            if ts >= end:
                nxt = auto_next(ev, cur)
                if nxt is None:
                    ev.queue_ended = True
                    ev.current_track_id = tracks[0].id
                    ev.started_at = None
                else:
                    ev.current_track_id = nxt.id
                    # Стыкуем треки без зазора, если сервер не отстал.
                    ev.started_at = end if ts - end < 1.0 else ts
                ev.position = 0.0
    elif ev.started_at is not None:
        if ev.paused:
            ev.position = ts - ev.started_at
        else:
            # Перемена закончилась или выключили музыку — следующую перемену начнём со следующего трека.
            nxt = cur if cur and (cur.loop or ev.repeat_mode == "one") else _neighbor(ev, cur, 1)
            ev.current_track_id = nxt.id if nxt else None
            ev.position = 0.0
        ev.started_at = None

    return before != (ev.current_track_id, ev.started_at, ev.position, ev.queue_ended)


# ---- Команды администратора ----

def op_play(ev: Event, ts: float) -> None:
    ev.paused = False
    ev.queue_ended = False


def op_pause(ev: Event, ts: float) -> None:
    if ev.started_at is not None:
        ev.position = max(0.0, ts - ev.started_at)
        ev.started_at = None
    ev.paused = True


def op_next(ev: Event, ts: float) -> None:
    _switch(ev, _neighbor(ev, get_track(ev, ev.current_track_id), 1), ts)


def op_prev(ev: Event, ts: float) -> None:
    cur = get_track(ev, ev.current_track_id)
    if cur is not None and current_position(ev, ts) > RESTART_THRESHOLD:
        _switch(ev, cur, ts)
    else:
        _switch(ev, _neighbor(ev, cur, -1), ts)


def op_jump(ev: Event, track: Track, ts: float) -> None:
    _switch(ev, track, ts)
    ev.paused = False


def op_seek(ev: Event, position: float, ts: float) -> None:
    cur = get_track(ev, ev.current_track_id)
    if cur is None:
        return
    position = max(0.0, min(position, cur.duration - 0.5))
    if ev.started_at is not None:
        ev.started_at = ts - position
    else:
        ev.position = position


def before_track_removed(ev: Event, track: Track, ts: float) -> None:
    """Если убираем текущий трек — переключаемся на следующий."""
    if ev.current_track_id != track.id:
        return
    others = [t for t in playable(ev) if t.id != track.id]
    nxt = _neighbor(ev, track, 1) if others else None
    if nxt is not None and nxt.id == track.id:
        nxt = None
    _switch(ev, nxt, ts)


# ---- Сериализация ----

def track_dict(t: Track | None) -> dict | None:
    if t is None:
        return None
    return {
        "id": t.id,
        "title": t.title,
        "artist": t.artist,
        "duration": round(t.duration, 3),
        "loop": t.loop,
        "enabled": t.enabled,
        "order": t.position,
        "original_name": t.original_name,
    }


def build_state(ev: Event, ts: float) -> dict:
    window, window_end, next_start = find_window(ev, ts)
    cur = get_track(ev, ev.current_track_id)
    if ev.started_at is not None:
        upcoming = auto_next(ev, cur)
    else:
        upcoming = None
    return {
        "event": {"id": ev.id, "name": ev.name, "date": ev.date.isoformat()},
        "mode": ev.mode,
        "repeat_mode": ev.repeat_mode,
        "paused": ev.paused,
        "playing": ev.started_at is not None,
        "track": track_dict(cur),
        "started_at": ev.started_at,
        "position": round(ev.position, 3),
        "next_track": track_dict(upcoming),
        "window_active": window,
        "window_end": window_end,
        "next_start": next_start,
        "queue_ended": ev.queue_ended,
        "tracks": [track_dict(t) for t in ordered(ev)],
        "breaks": [{"start": b.start, "end": b.end} for b in sorted(ev.breaks, key=lambda b: b.start)],
        "timezone": ev.timezone,
    }

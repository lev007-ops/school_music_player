import json
import time

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .db import SessionLocal
from .deps import resolve_token
from .hub import Conn, hub
from .models import Device, Event

router = APIRouter()


def _touch(event_id: int, device_id: int | None) -> None:
    now = time.time()
    with SessionLocal() as db:
        ev = db.get(Event, event_id)
        if ev is not None:
            ev.last_activity_at = now
        dev = db.get(Device, device_id) if device_id is not None else None
        if dev is not None:
            dev.last_seen_at = now
        db.commit()


@router.websocket("/ws")
async def event_socket(ws: WebSocket, t: str = ""):
    with SessionLocal() as db:
        ctx = resolve_token(db, t)
        ev = db.get(Event, ctx.event_id) if ctx else None
    await ws.accept()
    if ctx is None or ev is None:
        # 4001 — токен недействителен: клиент должен выйти из события.
        await ws.close(code=4001, reason="unauthorized")
        return

    conn = Conn(ws, ctx.kind, ctx.event_id, ctx.device_id)
    hub.add(conn)
    _touch(conn.event_id, conn.device_id)
    try:
        with SessionLocal() as db:
            ev = db.get(Event, ctx.event_id)
            if ev is None:
                await conn.close(4004, "deleted")
                return
            await hub.send_state_to(conn, ev)
        if conn.kind == "admin":
            await conn.send_text(json.dumps({"type": "devices", "devices": hub.devices_list(conn.event_id)}))
        else:
            hub.mark_devices_dirty(conn.event_id)

        while True:
            msg = json.loads(await ws.receive_text())
            kind = msg.get("type")
            if kind == "ping":
                await conn.send_text(json.dumps({"type": "pong", "t0": msg.get("t0"), "server_time": time.time()}))
            elif kind == "status" and conn.kind == "device":
                status = msg.get("status")
                if isinstance(status, dict):
                    conn.status = {k: status[k] for k in ("playing", "blocked", "drift_ms", "error", "listening") if k in status}
                    hub.mark_devices_dirty(conn.event_id)
    except (WebSocketDisconnect, json.JSONDecodeError, RuntimeError):
        pass
    finally:
        hub.remove(conn)
        _touch(conn.event_id, conn.device_id)
        if conn.kind == "device":
            hub.mark_devices_dirty(conn.event_id)

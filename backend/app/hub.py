"""WebSocket-подключения к событиям и рассылка состояния."""

import asyncio
import json
import logging
import time

from fastapi import WebSocket
from sqlalchemy import select

from .db import SessionLocal
from .engine import build_state
from .models import Device, Event

log = logging.getLogger(__name__)


class Conn:
    def __init__(self, ws: WebSocket, kind: str, event_id: int, device_id: int | None = None) -> None:
        self.ws = ws
        self.kind = kind  # admin | device
        self.event_id = event_id
        self.device_id = device_id
        self.status: dict = {}
        self._lock = asyncio.Lock()

    async def send_text(self, text: str) -> None:
        try:
            async with self._lock:
                await self.ws.send_text(text)
        except Exception:
            pass

    async def close(self, code: int, reason: str = "") -> None:
        try:
            await self.ws.close(code=code, reason=reason)
        except Exception:
            pass


class Hub:
    def __init__(self) -> None:
        self.conns: dict[int, set[Conn]] = {}
        self._last_key: dict[int, str] = {}
        self._devices_dirty: set[int] = set()

    def add(self, conn: Conn) -> None:
        self.conns.setdefault(conn.event_id, set()).add(conn)

    def remove(self, conn: Conn) -> None:
        group = self.conns.get(conn.event_id)
        if group is not None:
            group.discard(conn)
            if not group:
                del self.conns[conn.event_id]
                self._last_key.pop(conn.event_id, None)

    def device_conns(self, event_id: int) -> dict[int, Conn]:
        return {c.device_id: c for c in self.conns.get(event_id, ()) if c.kind == "device" and c.device_id}

    async def _send_all(self, conns, payload: dict) -> None:
        text = json.dumps(payload)
        await asyncio.gather(*(c.send_text(text) for c in list(conns)))

    def state_payload(self, ev: Event, ts: float) -> tuple[dict, str]:
        state = build_state(ev, ts)
        return state, json.dumps(state, sort_keys=True)

    async def push_state(self, ev: Event, ts: float | None = None, only_if_changed: bool = False) -> None:
        if ev.id not in self.conns:
            return
        ts = time.time() if ts is None else ts
        state, key = self.state_payload(ev, ts)
        if only_if_changed and self._last_key.get(ev.id) == key:
            return
        self._last_key[ev.id] = key
        await self._send_all(self.conns.get(ev.id, ()), {"type": "state", "server_time": ts, "state": state})

    async def send_state_to(self, conn: Conn, ev: Event) -> None:
        ts = time.time()
        state, _ = self.state_payload(ev, ts)
        await conn.send_text(json.dumps({"type": "state", "server_time": ts, "state": state}))

    def devices_list(self, event_id: int) -> list[dict]:
        online = self.device_conns(event_id)
        with SessionLocal() as db:
            devices = db.scalars(select(Device).where(Device.event_id == event_id).order_by(Device.created_at)).all()
            return [
                {
                    "id": d.id,
                    "name": d.name,
                    "user_agent": d.user_agent,
                    "created_at": d.created_at,
                    "last_seen_at": d.last_seen_at,
                    "online": d.id in online,
                    "status": online[d.id].status if d.id in online else None,
                }
                for d in devices
            ]

    def mark_devices_dirty(self, event_id: int) -> None:
        self._devices_dirty.add(event_id)

    async def flush_devices(self) -> None:
        dirty, self._devices_dirty = self._devices_dirty, set()
        for event_id in dirty:
            admins = [c for c in self.conns.get(event_id, ()) if c.kind == "admin"]
            if admins:
                await self._send_all(admins, {"type": "devices", "devices": self.devices_list(event_id)})

    async def close_event(self, event_id: int, code: int, reason: str) -> None:
        for c in list(self.conns.get(event_id, ())):
            await c.close(code, reason)

    async def close_device(self, event_id: int, device_id: int, code: int, reason: str) -> None:
        for c in list(self.conns.get(event_id, ())):
            if c.device_id == device_id:
                await c.close(code, reason)


hub = Hub()

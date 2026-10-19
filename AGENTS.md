# AGENTS.md

This file provides guidance to Codex (claude.ai/code) when working with code in this repository.

School break-time music service: an admin uploads tracks and a bell schedule; every joined browser plays the same track in sync during breaks. UI text and user-facing error messages are in Russian — keep it that way.

## Commands

```bash
# Production / full-stack check (single container, exposed only on 127.0.0.1:${APP_PORT:-8080})
docker compose up -d --build

# Backend (Python via uv — do not use pip or the system python; the local pyenv python is broken)
cd backend
uv sync
APP_DATA_DIR=../data uv run alembic upgrade head
APP_DATA_DIR=../data APP_STATIC_DIR=../frontend/dist uv run uvicorn app.main:app --reload   # :8000

# New migration after changing app/models.py
APP_DATA_DIR=../data uv run alembic revision --autogenerate -m "..."

# Frontend
cd frontend
npm install
npm run dev     # Vite, proxies /api (incl. WebSocket) to 127.0.0.1:8000
npm run build   # tsc -b && vite build — also the type check
```

There is no test suite or linter configured. Backend checks so far were ad-hoc scripts using `fastapi.testclient.TestClient` (httpx is a dev dependency); run them with `PYTHONPATH=. uv run python script.py` from `backend/`.

## Architecture

**Single process, single deployable.** The Dockerfile builds the frontend with Node, then serves `dist/` as static files from FastAPI (`app/main.py` SPA catch-all after the `/api` routers). Uvicorn must run with exactly **one worker**: WebSocket connections (`app/hub.py`) and the playback loop live in process memory.

**Server is the single source of truth for playback; the admin device does not need to be online.**
- Playback state is stored on the `Event` row: `mode` (auto/on/off), `repeat_mode` (all/one/off), `paused`, `current_track_id`, `started_at` (server unix time when the current track was at position 0; `None` = not sounding), `position` (resume offset when not sounding), `queue_ended`.
- `app/engine.py` holds pure functions over `(event, ts)`. `find_window` decides whether music should sound (schedule in the event's own IANA `timezone`, only on the event's `date`). `step` advances state: it starts and stops on break boundaries and moves to the next track when `started_at + duration` passes. The `op_*` functions are admin commands.
- `player_loop` in `main.py` ticks every 0.25s. It runs `step` for all relevant events synchronously, commits, and only then awaits broadcasts. Admin endpoints mutate through `routes_admin.apply()`, which does refresh → op → `step` → commit with no `await` in between, then pushes state. All DB work runs on the event-loop thread (async handlers + sync SQLAlchemy session), so this ordering is what prevents lost updates. Keep that invariant when adding mutating endpoints.

**Clients.** All clients use one WebSocket, `/api/ws?t=<token>`. It carries `state` pushes (the full `build_state` dict, re-sent whenever it changes), `devices` (admins only), `ping`/`pong` for clock sync, and `status` (device → server → admin device list). Close code 4001 means the token was revoked or the device was removed; 4004 means the event was deleted. The client handles both in `lib/socket.ts`.
- `frontend/src/lib/player.ts` (`SyncPlayer` singleton) turns state into sound. It fetches track audio as blobs with a Bearer header (current + next track prefetched), computes the expected position as `clock.now() - started_at` (`lib/clock.ts`, NTP-like offset from WS pings), and corrects drift with `playbackRate` nudges (<0.5s) or seeks. It fades out over the last 3s before `window_end`. Ticks come from a Web Worker timer to survive background-tab throttling. `unlock()` must be called from a user gesture because of autoplay policies.
- Admin and device pages share the same player. On the admin page it is enabled only by the "listen on this device" toggle.

**Auth.** Opaque random tokens are stored as SHA-256 hashes (`AdminSession`, `Device`). They are sent as `Authorization: Bearer`, or as `?t=` for the WebSocket. The admin password (16 chars, shown once) is also stored as an unsalted SHA-256, so the event can be looked up by password alone. Event codes are 6 digits, valid 7 days, and unique among unexpired codes; regenerating a code does not affect already-joined devices. The frontend keeps sessions in localStorage (`lib/storage.ts`). Routing is a tiny pushState router over three paths: `/`, `/admin`, `/player`.

**Data lifecycle.** SQLite and audio files live in `APP_DATA_DIR` (`./data` volume; files at `music/<event_id>/<uuid>.<ext>`). `Event.last_activity_at` is bumped on admin login, device join, WS connect/disconnect, and every 10 min while anyone is connected. `cleanup_loop` deletes events (DB cascade + music folder) after `APP_INACTIVE_EVENT_TTL_DAYS` (7) days of inactivity. Track durations come from mutagen at upload time and drive server-side track switching.

**Schedule format** (import/export and the create-event textarea): one `HH:MM-HH:MM` break per line; blank lines and `#` comments are ignored. Parsing and validation (ordering, overlap) live in `app/schedule.py`.

Settings come from `APP_*` env vars (`app/config.py`, pydantic-settings). `APP_TIMEZONE` is only the fallback when the creator's browser sends no timezone.

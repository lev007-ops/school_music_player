import { clock } from "./clock";
import type { DeviceStatus, EventState } from "./types";

const SILENT_WAV =
  "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=";
const FADE_SECONDS = 3; // затухание перед концом перемены
const SEEK_THRESHOLD = 0.5; // сек: при большем расхождении — перемотка
const NUDGE_THRESHOLD = 0.03; // сек: при меньшем — ничего не делаем
const TICK_MS = 200;

export interface PlayerSnapshot extends DeviceStatus {
  loading: boolean;
  sinkSupported: boolean;
}

/**
 * Воспроизводит состояние сервера синхронно с другими устройствами:
 * ожидаемая позиция = время_сервера − started_at; расхождение
 * устраняется плавным изменением скорости или перемоткой.
 */
class SyncPlayer {
  readonly audio = new Audio();
  private state: EventState | null = null;
  private token = "";
  private enabled = false;
  private volume = 1;
  private loadedTrackId: number | null = null;
  private loadingTrackId: number | null = null;
  private cache = new Map<number, Promise<string>>();
  private urls = new Map<number, string>();
  private busy = false;
  private listeners = new Set<(s: PlayerSnapshot) => void>();
  snapshot: PlayerSnapshot = {
    playing: false,
    blocked: false,
    loading: false,
    drift_ms: null,
    error: null,
    sinkSupported: "setSinkId" in HTMLMediaElement.prototype,
  };

  constructor() {
    this.audio.preload = "auto";
    // Таймеры в воркере не замедляются во фоновых вкладках так сильно, как на основном потоке.
    try {
      const src = `setInterval(() => postMessage(0), ${TICK_MS});`;
      const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      worker.onmessage = () => void this.tick();
    } catch {
      setInterval(() => void this.tick(), TICK_MS);
    }
  }

  subscribe(fn: (s: PlayerSnapshot) => void): () => void {
    this.listeners.add(fn);
    fn(this.snapshot);
    return () => this.listeners.delete(fn);
  }

  private update(patch: Partial<PlayerSnapshot>) {
    const next = { ...this.snapshot, ...patch };
    const changed = (Object.keys(patch) as (keyof PlayerSnapshot)[]).some((k) => next[k] !== this.snapshot[k]);
    if (!changed) return;
    this.snapshot = next;
    this.listeners.forEach((fn) => fn(next));
  }

  /** Подключение к событию: вызывать при смене токена. */
  attach(token: string) {
    if (token === this.token) return;
    this.reset();
    this.token = token;
  }

  reset() {
    this.audio.pause();
    this.audio.removeAttribute("src");
    this.audio.load();
    this.state = null;
    this.loadedTrackId = null;
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls.clear();
    this.cache.clear();
    this.token = "";
  }

  setState(state: EventState) {
    this.state = state;
    this.prefetch();
    void this.tick();
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    void this.tick();
  }

  setVolume(volume: number) {
    this.volume = Math.max(0, Math.min(1, volume));
    void this.tick();
  }

  async setSink(deviceId: string): Promise<void> {
    const el = this.audio as HTMLAudioElement & { setSinkId?: (id: string) => Promise<void> };
    if (!el.setSinkId) throw new Error("Браузер не поддерживает выбор устройства вывода");
    await el.setSinkId(deviceId);
  }

  /** Разблокировка автозапуска: вызывать из обработчика клика. */
  async unlock(): Promise<void> {
    const wasLoaded = this.loadedTrackId;
    try {
      if (wasLoaded === null) {
        this.audio.src = SILENT_WAV;
        await this.audio.play();
        this.audio.pause();
      } else {
        await this.audio.play();
      }
      this.update({ blocked: false });
    } catch {
      /* останется заблокированным */
    }
    void this.tick();
  }

  private fetchTrack(id: number): Promise<string> {
    let p = this.cache.get(id);
    if (!p) {
      p = fetch(`/api/tracks/${id}/audio`, { headers: { Authorization: `Bearer ${this.token}` } })
        .then((r) => {
          if (!r.ok) throw new Error(`Не удалось загрузить трек (${r.status})`);
          return r.blob();
        })
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          this.urls.set(id, url);
          return url;
        });
      p.catch(() => this.cache.delete(id));
      this.cache.set(id, p);
    }
    return p;
  }

  /** Держим в памяти текущий и следующий трек, остальные освобождаем. */
  private prefetch() {
    const s = this.state;
    if (!s || !this.token) return;
    const keep = new Set<number>();
    for (const t of [s.track, s.next_track]) if (t) keep.add(t.id);
    if (this.loadedTrackId !== null) keep.add(this.loadedTrackId);
    if (this.enabled) keep.forEach((id) => void this.fetchTrack(id).catch(() => undefined));
    for (const id of [...this.cache.keys()]) {
      if (keep.has(id)) continue;
      const url = this.urls.get(id);
      if (url) URL.revokeObjectURL(url);
      this.urls.delete(id);
      this.cache.delete(id);
    }
  }

  private async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.sync();
    } finally {
      this.busy = false;
    }
  }

  private stop() {
    if (!this.audio.paused) this.audio.pause();
    this.update({ playing: false, drift_ms: null, loading: false });
  }

  private async sync() {
    const s = this.state;
    const track = s?.track;
    if (!this.enabled || !s || !s.playing || !track || s.started_at === null || !this.token) return this.stop();

    const now = clock.now();
    if (now - s.started_at >= track.duration) return this.stop(); // ждём, пока сервер переключит трек

    if (this.loadedTrackId !== track.id) {
      if (this.loadingTrackId === track.id) return;
      this.loadingTrackId = track.id;
      this.update({ loading: true });
      try {
        const url = await this.fetchTrack(track.id);
        if (this.state?.track?.id !== track.id) return;
        this.audio.src = url;
        await new Promise<void>((resolve, reject) => {
          this.audio.onloadedmetadata = () => resolve();
          this.audio.onerror = () => reject(new Error("Браузер не может воспроизвести этот формат"));
        });
        this.loadedTrackId = track.id;
        this.update({ error: null });
      } catch (e) {
        this.update({ error: e instanceof Error ? e.message : String(e), loading: false });
        return;
      } finally {
        this.loadingTrackId = null;
      }
      this.prefetch();
    }

    const t = clock.now();
    const expected = t - s.started_at;
    const fade = s.window_end === null ? 1 : Math.max(0, Math.min(1, (s.window_end - t) / FADE_SECONDS));
    this.audio.volume = this.volume * fade;

    if (this.audio.paused) {
      this.audio.playbackRate = 1;
      this.audio.currentTime = expected;
      try {
        await this.audio.play();
        this.update({ blocked: false, playing: true, loading: false });
      } catch (e) {
        const blocked = e instanceof DOMException && e.name === "NotAllowedError";
        this.update({ blocked, playing: false, loading: false });
      }
      return;
    }

    const drift = this.audio.currentTime - expected; // > 0 — играем с опережением
    if (Math.abs(drift) > SEEK_THRESHOLD) {
      this.audio.playbackRate = 1;
      this.audio.currentTime = expected;
    } else if (Math.abs(drift) > NUDGE_THRESHOLD) {
      this.audio.playbackRate = 1 - Math.max(-0.05, Math.min(0.05, drift * 0.5));
    } else {
      this.audio.playbackRate = 1;
    }
    this.update({ playing: true, loading: false, drift_ms: Math.round(drift * 1000) });
  }
}

export const player = new SyncPlayer();

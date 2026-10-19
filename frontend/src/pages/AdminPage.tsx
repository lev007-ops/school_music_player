import { useCallback, useEffect, useRef, useState } from "react";
import { ConfirmModal, ErrorText, Modal } from "../components/Modal";
import { NowPlaying } from "../components/NowPlaying";
import { OutputControls } from "../components/OutputControls";
import { CopyField } from "../components/CopyField";
import { DateInput } from "../components/DateInput";
import { TimeInput, parseTime } from "../components/TimeInput";
import { api, downloadFile } from "../lib/api";
import { clock } from "../lib/clock";
import { describeUserAgent, formatClock, formatDate, formatDateTime, formatDuration, trackLabel } from "../lib/format";
import { player } from "../lib/player";
import { navigate } from "../lib/router";
import { adminSession, pref, setPref } from "../lib/storage";
import type { BreakItem, DeviceInfo, EventInfo, EventState, Mode, RepeatMode, Track } from "../lib/types";
import { useEventConnection, useTicker } from "../lib/useEventConnection";
import { usePlayerSnapshot } from "../lib/usePlayer";
import { AUDIO_ACCEPT, UploadList, uploadMany } from "./Home";

type Call = <T = void>(path: string, opts?: { method?: string; body?: unknown; form?: FormData }) => Promise<T>;

function logout(notice?: string) {
  adminSession.set(null);
  if (notice) sessionStorage.setItem("music.notice", notice);
  navigate("/");
}

export function AdminPage({ token }: { token: string }) {
  const { state, devices, connected } = useEventConnection(token, (code) =>
    logout(code === 4004 ? "Событие удалено." : "Сессия администратора недействительна."),
  );
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [error, setError] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  const call: Call = useCallback(
    async (path, opts = {}) => {
      try {
        setError("");
        return await api(path, { ...opts, token });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if ((e as { status?: number }).status === 401) logout("Сессия администратора недействительна.");
        setError(msg);
        throw e;
      }
    },
    [token],
  );

  useEffect(() => {
    call<EventInfo>("/admin/event").then(setInfo, () => undefined);
  }, [call]);

  useEffect(() => {
    if (state && info && (state.event.name !== info.name || state.event.date !== info.date)) {
      setInfo({ ...info, name: state.event.name, date: state.event.date });
      adminSession.set({ token, eventName: state.event.name });
    }
  }, [state, info, token]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Управление событием</div>
          <h1 className="truncate text-2xl font-bold">{info?.name ?? "…"}</h1>
          {info && (
            <div className="text-sm text-slate-500">
              {formatDate(info.date)} · {info.timezone}
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => navigate("/")}>
            На главную
          </button>
          <button className="btn-ghost" onClick={() => logout()}>
            Выйти
          </button>
        </div>
      </header>

      {!connected && <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Нет связи с сервером, переподключаемся…</div>}
      {error && (
        <div className="mb-4 flex items-start justify-between gap-2 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError("")}>✕</button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {state && <PlayerPanel state={state} call={call} />}
          {state && <QueuePanel state={state} call={call} token={token} />}
        </div>
        <div className="space-y-4">
          {info && <CodePanel info={info} setInfo={setInfo} call={call} />}
          {state && <SchedulePanel state={state} token={token} />}
          <DevicesPanel devices={devices} call={call} />
          {info && <SettingsPanel info={info} setInfo={setInfo} call={call} onDelete={() => setConfirmDelete(true)} />}
        </div>
      </div>

      {confirmDelete && (
        <ConfirmModal
          title="Удалить событие?"
          text="Будут удалены музыка, расписание и все подключённые устройства. Отменить нельзя."
          confirmLabel="Удалить навсегда"
          onConfirm={() => void call("/admin/event", { method: "DELETE" }).then(() => logout("Событие удалено."))}
          onClose={() => setConfirmDelete(false)}
        />
      )}
    </div>
  );
}

function Segmented<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap rounded-xl bg-slate-100 p-1">
      {options.map(([v, label]) => (
        <button
          key={v}
          className={`rounded-lg px-3 py-1.5 text-sm transition ${value === v ? "bg-white font-medium shadow-sm" : "text-slate-600 hover:text-slate-900"}`}
          onClick={() => v !== value && onChange(v)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function PlayerPanel({ state, call }: { state: EventState; call: Call }) {
  const [listen, setListen] = useState(() => pref("admin.listen", false));
  const snap = usePlayerSnapshot();

  useEffect(() => {
    player.setEnabled(listen);
    setPref("admin.listen", listen);
    return () => player.setEnabled(false);
  }, [listen]);

  const ignore = () => undefined;
  const post = (path: string, body?: unknown) => void call(path, { method: "POST", body }).catch(ignore);
  const patch = (body: { mode?: Mode; repeat_mode?: RepeatMode }) => void call("/admin/player", { method: "PATCH", body }).catch(ignore);

  return (
    <section className="card">
      <NowPlaying state={state} onSeek={(position) => post("/admin/player/seek", { position })} />
      <div className="mt-4 flex items-center justify-center gap-3">
        <button className="btn-secondary h-12 w-12 rounded-full p-0 text-lg" title="Предыдущий" onClick={() => post("/admin/player/prev")}>
          ⏮
        </button>
        {state.paused ? (
          <button className="btn-primary h-14 w-14 rounded-full p-0 text-xl" title="Продолжить" onClick={() => post("/admin/player/play")}>
            ▶
          </button>
        ) : (
          <button className="btn-primary h-14 w-14 rounded-full p-0 text-xl" title="Пауза" onClick={() => post("/admin/player/pause")}>
            ⏸
          </button>
        )}
        <button className="btn-secondary h-12 w-12 rounded-full p-0 text-lg" title="Следующий" onClick={() => post("/admin/player/next")}>
          ⏭
        </button>
      </div>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div>
          <div className="label">Когда играть</div>
          <Segmented<Mode>
            value={state.mode}
            onChange={(mode) => patch({ mode })}
            options={[
              ["auto", "По расписанию"],
              ["on", "Сейчас"],
              ["off", "Тишина"],
            ]}
          />
        </div>
        <div>
          <div className="label">Повтор</div>
          <Segmented<RepeatMode>
            value={state.repeat_mode}
            onChange={(repeat_mode) => patch({ repeat_mode })}
            options={[
              ["all", "Очередь по кругу"],
              ["one", "Один трек"],
              ["off", "Без повтора"],
            ]}
          />
        </div>
      </div>

      <div className="mt-5 border-t border-slate-100 pt-4">
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block font-medium">Слушать на этом устройстве</span>
            <span className="text-sm text-slate-500">
              {listen ? (snap.playing ? "Звук идёт синхронно с остальными устройствами" : "Звук включится, когда начнётся музыка") : "Это устройство не воспроизводит музыку"}
            </span>
          </span>
          <input
            type="checkbox"
            className="peer sr-only"
            checked={listen}
            onChange={(e) => {
              if (e.target.checked) void player.unlock();
              setListen(e.target.checked);
            }}
          />
          <span className="relative h-6 w-11 shrink-0 rounded-full bg-slate-300 transition after:absolute after:left-0.5 after:top-0.5 after:h-5 after:w-5 after:rounded-full after:bg-white after:transition peer-checked:bg-indigo-600 peer-checked:after:translate-x-5" />
        </label>
        {listen && (
          <div className="mt-4">
            <OutputControls prefix="admin" />
            {snap.blocked && (
              <button className="btn-primary mt-3 w-full" onClick={() => void player.unlock()}>
                Браузер заблокировал звук — нажмите, чтобы включить
              </button>
            )}
            {snap.error && <p className="mt-2 text-sm text-rose-600">{snap.error}</p>}
          </div>
        )}
      </div>
    </section>
  );
}

function QueuePanel({ state, call, token }: { state: EventState; call: Call; token: string }) {
  const [order, setOrder] = useState<Track[]>(state.tracks);
  const [dragId, setDragId] = useState<number | null>(null);
  const [uploads, setUploads] = useState<{ name: string; progress: number; error?: string; done?: boolean }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [dropActive, setDropActive] = useState(false);
  const [toDelete, setToDelete] = useState<Track | null>(null);
  const [editing, setEditing] = useState<Track | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (dragId === null) setOrder(state.tracks);
  }, [state.tracks, dragId]);

  const ignore = () => undefined;
  const totalDuration = state.tracks.filter((t) => t.enabled).reduce((s, t) => s + t.duration, 0);

  const upload = async (files: File[]) => {
    if (!files.length) return;
    setUploading(true);
    const result = await uploadMany(files, token, setUploads);
    setUploading(false);
    if (!result.some((r) => r.error)) setTimeout(() => setUploads([]), 2500);
  };

  const move = (from: number, to: number) => {
    if (to < 0 || to >= order.length || from === to) return;
    const next = [...order];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    setOrder(next);
    return next;
  };

  const saveOrder = (list: Track[]) => void call("/admin/tracks/order", { method: "PUT", body: { ids: list.map((t) => t.id) } }).catch(ignore);
  const patchTrack = (t: Track, body: Partial<Pick<Track, "loop" | "enabled" | "title" | "artist">>) =>
    void call(`/admin/tracks/${t.id}`, { method: "PATCH", body }).catch(ignore);

  return (
    <section
      className={`card transition ${dropActive ? "border-indigo-400 ring-2 ring-indigo-100" : ""}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropActive(true);
        }
      }}
      onDragLeave={() => setDropActive(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDropActive(false);
        void upload([...e.dataTransfer.files]);
      }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Очередь</h2>
          <div className="text-sm text-slate-500">
            {state.tracks.length} треков · {formatDuration(totalDuration)}
          </div>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={() => void call("/admin/tracks/shuffle", { method: "POST" }).catch(ignore)} disabled={state.tracks.length < 2}>
            🔀 Перемешать
          </button>
          <button className="btn-primary" onClick={() => fileInput.current?.click()} disabled={uploading}>
            + Добавить музыку
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={AUDIO_ACCEPT}
            className="hidden"
            onChange={(e) => {
              void upload([...(e.target.files ?? [])]);
              e.target.value = "";
            }}
          />
        </div>
      </div>

      <UploadList items={uploads} />

      {order.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-10 text-center text-slate-500">
          Перетащите сюда аудиофайлы или нажмите «Добавить музыку»
        </div>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100">
          {order.map((t, i) => {
            const current = state.track?.id === t.id;
            return (
              <li
                key={t.id}
                draggable
                onDragStart={(e) => {
                  setDragId(t.id);
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  if (dragId === null) return;
                  e.preventDefault();
                  const from = order.findIndex((x) => x.id === dragId);
                  if (from !== i) move(from, i);
                }}
                onDragEnd={() => {
                  if (dragId !== null) saveOrder(order);
                  setDragId(null);
                }}
                className={`group flex items-center gap-2 py-2 ${dragId === t.id ? "opacity-40" : ""} ${t.enabled ? "" : "opacity-50"}`}
              >
                <span className="cursor-grab select-none px-1 text-slate-300 active:cursor-grabbing" title="Перетащите, чтобы изменить порядок">
                  ⠿
                </span>
                <span className={`w-6 text-right text-xs tabular-nums ${current ? "text-indigo-600" : "text-slate-400"}`}>
                  {current ? (state.playing ? "▶" : "❚❚") : i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className={`truncate text-sm ${current ? "font-semibold text-indigo-700" : ""}`} title={trackLabel(t)}>
                    {trackLabel(t)}
                  </div>
                  <div className="truncate text-xs text-slate-400" title={t.original_name}>
                    {formatDuration(t.duration)}
                    <span className="ml-2">{t.original_name}</span>
                    {t.loop && <span className="ml-2 text-indigo-600">зациклен</span>}
                    {!t.enabled && <span className="ml-2">пропускается</span>}
                  </div>
                </div>
                <div className="flex shrink-0 items-center">
                  <button className="icon-btn" title="Играть сейчас" onClick={() => void call("/admin/player/jump", { method: "POST", body: { track_id: t.id } }).catch(ignore)}>
                    ▶
                  </button>
                  <button className="icon-btn hidden sm:inline-flex" title="Играть следующим" onClick={() => void call("/admin/tracks/play-next", { method: "POST", body: { track_id: t.id } }).catch(ignore)}>
                    ⤵
                  </button>
                  <button className={`icon-btn ${t.loop ? "bg-indigo-50 text-indigo-600" : ""}`} title="Зациклить трек" onClick={() => patchTrack(t, { loop: !t.loop })}>
                    🔁
                  </button>
                  <button className="icon-btn" title={t.enabled ? "Пропускать" : "Включить"} onClick={() => patchTrack(t, { enabled: !t.enabled })}>
                    {t.enabled ? "◉" : "○"}
                  </button>
                  <button className="icon-btn hidden sm:inline-flex" title="Выше" disabled={i === 0} onClick={() => { const n = move(i, i - 1); if (n) saveOrder(n); }}>
                    ↑
                  </button>
                  <button className="icon-btn hidden sm:inline-flex" title="Ниже" disabled={i === order.length - 1} onClick={() => { const n = move(i, i + 1); if (n) saveOrder(n); }}>
                    ↓
                  </button>
                  <button className="icon-btn" title="Изменить название и исполнителя" onClick={() => setEditing(t)}>
                    ✎
                  </button>
                  <button className="icon-btn hover:text-rose-600" title="Удалить" onClick={() => setToDelete(t)}>
                    🗑
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {toDelete && (
        <ConfirmModal
          title="Удалить трек?"
          text={`«${trackLabel(toDelete)}» будет удалён с сервера.`}
          confirmLabel="Удалить"
          onConfirm={() => void call(`/admin/tracks/${toDelete.id}`, { method: "DELETE" }).catch(ignore)}
          onClose={() => setToDelete(null)}
        />
      )}
      {editing && <RenameDialog track={editing} onClose={() => setEditing(null)} onSave={(body) => patchTrack(editing, body)} />}
    </section>
  );
}

function RenameDialog({ track, onClose, onSave }: { track: Track; onClose: () => void; onSave: (body: { title: string; artist: string }) => void }) {
  const [title, setTitle] = useState(track.title);
  const [artist, setArtist] = useState(track.artist);
  return (
    <Modal title="Трек" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          onSave({ title: title.trim(), artist: artist.trim() });
          onClose();
        }}
      >
        <label className="block space-y-1">
          <span className="text-sm text-slate-600">Название</span>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={300} autoFocus />
        </label>
        <label className="block space-y-1">
          <span className="text-sm text-slate-600">Исполнитель</span>
          <input className="input" value={artist} onChange={(e) => setArtist(e.target.value)} maxLength={300} placeholder="Не указан" />
        </label>
        <p className="break-all text-xs text-slate-500">Файл: {track.original_name}</p>
        <button className="btn-primary w-full" disabled={!title.trim()}>
          Сохранить
        </button>
      </form>
    </Modal>
  );
}

function CodePanel({ info, setInfo, call }: { info: EventInfo; setInfo: (i: EventInfo) => void; call: Call }) {
  useTicker(30_000);
  const expired = info.code_expires_at * 1000 <= Date.now();
  const [busy, setBusy] = useState(false);
  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-semibold">Код подключения</h2>
      <CopyField label="Для устройств-плееров" value={info.code} big />
      <p className={`mt-2 text-sm ${expired ? "text-rose-600" : "text-slate-500"}`}>
        {expired ? "Срок действия кода истёк" : `Действует до ${formatDateTime(info.code_expires_at, info.timezone)}`}
      </p>
      <button
        className="btn-secondary mt-3 w-full"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          call<EventInfo>("/admin/code/regenerate", { method: "POST" })
            .then(setInfo, () => undefined)
            .finally(() => setBusy(false));
        }}
      >
        Сгенерировать новый код
      </button>
      <p className="mt-2 text-xs text-slate-500">Уже подключённые устройства останутся в событии.</p>
    </section>
  );
}

function SchedulePanel({ state, token }: { state: EventState; token: string }) {
  const [draft, setDraft] = useState<BreakItem[]>(state.breaks);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const importInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!dirty) setDraft(state.breaks);
  }, [state.breaks, dirty]);

  const edit = (next: BreakItem[]) => {
    setDraft(next);
    setDirty(true);
  };

  const save = async () => {
    const breaks = draft.filter((b) => b.start || b.end);
    if (breaks.some((b) => !parseTime(b.start) || !parseTime(b.end))) {
      setError("Укажите время в формате ЧЧ:ММ, например 09:45");
      return;
    }
    setError("");
    try {
      await api("/admin/schedule", { method: "PUT", body: { breaks }, token });
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const importFile = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    setError("");
    try {
      await api("/admin/schedule/import", { form, token });
      setDirty(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    }
  };

  const now = clock.now();
  const tz = state.timezone;
  const isCurrent = (b: BreakItem) => state.mode === "auto" && state.window_active && state.window_end !== null && formatClock(state.window_end, tz) === b.end;

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Перемены</h2>
        <div className="flex gap-1">
          <button className="btn-ghost px-2 py-1" onClick={() => importInput.current?.click()}>
            Импорт
          </button>
          <button className="btn-ghost px-2 py-1" onClick={() => void downloadFile("/admin/schedule/export", token, "schedule.txt").catch((e) => setError(e.message))}>
            Экспорт
          </button>
          <input
            ref={importInput}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      <p className="mb-3 text-sm text-slate-500">
        Сейчас на сервере {formatClock(now, tz)} ({tz})
        {state.mode !== "auto" && <span className="block text-amber-700">Расписание не действует: выбран режим «{state.mode === "on" ? "Сейчас" : "Тишина"}»</span>}
      </p>
      {draft.length === 0 && <p className="mb-3 text-sm text-slate-500">Перемен нет — музыка по расписанию играть не будет.</p>}
      <ul className="space-y-2">
        {draft.map((b, i) => (
          <li key={i} className={`flex items-center gap-2 rounded-xl ${!dirty && isCurrent(b) ? "bg-emerald-50 ring-1 ring-emerald-200" : ""}`}>
            <TimeInput value={b.start} onChange={(v) => edit(draft.map((x, j) => (j === i ? { ...x, start: v } : x)))} />
            <span className="text-slate-400">—</span>
            <TimeInput value={b.end} onChange={(v) => edit(draft.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
            <button className="icon-btn shrink-0 hover:text-rose-600" title="Удалить перемену" onClick={() => edit(draft.filter((_, j) => j !== i))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex gap-2">
        <button
          className="btn-secondary flex-1"
          onClick={() => {
            const last = draft[draft.length - 1];
            edit([...draft, { start: last?.end ?? "09:00", end: "" }]);
          }}
        >
          + Перемена
        </button>
        {dirty && (
          <>
            <button className="btn-ghost" onClick={() => { setDirty(false); setError(""); }}>
              Отмена
            </button>
            <button className="btn-primary" onClick={() => void save()}>
              Сохранить
            </button>
          </>
        )}
      </div>
      <div className="mt-2">
        <ErrorText>{error}</ErrorText>
      </div>
      <p className="mt-2 text-xs text-slate-500">Формат файла: строки HH:MM-HH:MM. За 3 секунды до конца перемены музыка плавно затихает.</p>
    </section>
  );
}

function deviceStatus(d: DeviceInfo): { text: string; tone: string } {
  if (!d.online) return { text: `не в сети · был ${formatDateTime(d.last_seen_at)}`, tone: "text-slate-400" };
  const s = d.status;
  if (s?.error) return { text: s.error, tone: "text-rose-600" };
  if (s?.blocked) return { text: "звук заблокирован браузером — нужно нажать на экран", tone: "text-amber-600" };
  if (s?.playing) return { text: `играет${typeof s.drift_ms === "number" ? ` · рассинхрон ${Math.abs(s.drift_ms)} мс` : ""}`, tone: "text-emerald-600" };
  return { text: "в сети · ожидает", tone: "text-slate-500" };
}

function DevicesPanel({ devices, call }: { devices: DeviceInfo[]; call: Call }) {
  const [toRemove, setToRemove] = useState<DeviceInfo | null>(null);
  const online = devices.filter((d) => d.online).length;
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">Устройства</h2>
      <p className="mb-3 text-sm text-slate-500">
        В сети {online} из {devices.length}
      </p>
      {devices.length === 0 ? (
        <p className="text-sm text-slate-500">Пока никто не подключился. Откройте сайт на устройстве и введите код.</p>
      ) : (
        <ul className="space-y-2">
          {devices.map((d) => {
            const st = deviceStatus(d);
            return (
              <li key={d.id} className="flex items-start gap-3">
                <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${d.online ? "bg-emerald-500" : "bg-slate-300"}`} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{d.name}</div>
                  <div className="truncate text-xs text-slate-400">{describeUserAgent(d.user_agent)}</div>
                  <div className={`text-xs ${st.tone}`}>{st.text}</div>
                </div>
                <button className="icon-btn shrink-0 hover:text-rose-600" title="Отключить устройство" onClick={() => setToRemove(d)}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {toRemove && (
        <ConfirmModal
          title="Отключить устройство?"
          text={`«${toRemove.name}» будет удалено из события. Для повторного подключения понадобится код.`}
          confirmLabel="Отключить"
          onConfirm={() => void call(`/admin/devices/${toRemove.id}`, { method: "DELETE" }).catch(() => undefined)}
          onClose={() => setToRemove(null)}
        />
      )}
    </section>
  );
}

function SettingsPanel({ info, setInfo, call, onDelete }: { info: EventInfo; setInfo: (i: EventInfo) => void; call: Call; onDelete: () => void }) {
  const [name, setName] = useState(info.name);
  const [date, setDate] = useState(info.date);
  const [timezone, setTimezone] = useState(info.timezone);
  const [zones, setZones] = useState<string[]>([]);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    call<string[]>("/admin/timezones").then(setZones, () => undefined);
  }, [call]);

  useEffect(() => {
    setName(info.name);
    setDate(info.date);
    setTimezone(info.timezone);
  }, [info]);

  const dirty = name.trim() !== info.name || date !== info.date || timezone !== info.timezone;
  const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const options = zones.includes(timezone) || !zones.length ? zones : [timezone, ...zones];

  return (
    <section className="card">
      <h2 className="mb-3 text-lg font-semibold">Настройки события</h2>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          call<EventInfo>("/admin/event", { method: "PATCH", body: { name: name.trim(), date, timezone } }).then(
            (i) => {
              setInfo(i);
              setSaved(true);
              setTimeout(() => setSaved(false), 1500);
            },
            () => undefined,
          );
        }}
      >
        <div>
          <label className="label">Название</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
        </div>
        <div>
          <label className="label">Дата</label>
          <DateInput value={date} onChange={setDate} />
        </div>
        <div>
          <label className="label">Часовой пояс</label>
          <select className="input" value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {(options.length ? options : [timezone]).map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          {browserTz !== timezone && (
            <button type="button" className="mt-1 text-xs text-indigo-600 hover:underline" onClick={() => setTimezone(browserTz)}>
              Использовать пояс этого устройства ({browserTz})
            </button>
          )}
          <p className="mt-1 text-xs text-slate-500">В этом поясе задана дата события и время перемен.</p>
        </div>
        <button className="btn-primary w-full" disabled={!dirty || !name.trim()}>
          {saved ? "Сохранено" : "Сохранить"}
        </button>
      </form>
      <div className="mt-5 border-t border-slate-100 pt-4">
        <button className="btn-ghost w-full text-rose-600 hover:bg-rose-50" onClick={onDelete}>
          Удалить событие
        </button>
        <p className="mt-1 text-center text-xs text-slate-400">Событие, в которое никто не заходит неделю, удаляется автоматически.</p>
      </div>
    </section>
  );
}


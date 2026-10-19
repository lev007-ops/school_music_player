import { useState, type FormEvent } from "react";
import { ErrorText, Modal } from "../components/Modal";
import { CopyField } from "../components/CopyField";
import { DateInput } from "../components/DateInput";
import { api, uploadTrack } from "../lib/api";
import { describeUserAgent, formatDateTime, todayIso } from "../lib/format";
import { player } from "../lib/player";
import { navigate } from "../lib/router";
import { adminSession, deviceSession } from "../lib/storage";
import type { CreateEventResult } from "../lib/types";

type Dialog = "create" | "join" | "admin" | null;

function consumeNotice(): string {
  const n = sessionStorage.getItem("music.notice") ?? "";
  sessionStorage.removeItem("music.notice");
  return n;
}

export function Home() {
  const [dialog, setDialog] = useState<Dialog>(null);
  const [notice] = useState(consumeNotice);
  const admin = adminSession.get();
  const device = deviceSession.get();

  return (
    <div className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
      <div className="mb-8 text-center">
        <div className="mb-3 text-5xl">🎵</div>
        <h1 className="text-3xl font-bold">Школьная музыка</h1>
        <p className="mt-2 text-slate-500">Музыка на переменах — одновременно на всех устройствах</p>
      </div>

      {notice && <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">{notice}</div>}

      <div className="flex flex-col gap-3">
        <button className="btn-primary py-4 text-base" onClick={() => setDialog("create")}>
          Создать событие
        </button>
        <button className="btn-secondary py-4 text-base" onClick={() => setDialog("join")}>
          Войти в событие
        </button>
        <button className="btn-secondary py-4 text-base" onClick={() => setDialog("admin")}>
          Войти в событие как администратор
        </button>
      </div>

      {(admin || device) && (
        <div className="mt-8 space-y-2">
          <div className="text-sm font-medium text-slate-500">Продолжить</div>
          {admin && (
            <button className="card flex w-full items-center justify-between text-left hover:border-indigo-300" onClick={() => navigate("/admin")}>
              <span>
                <span className="block text-xs text-slate-500">Управление</span>
                {admin.eventName}
              </span>
              <span className="text-indigo-600">→</span>
            </button>
          )}
          {device && (
            <button className="card flex w-full items-center justify-between text-left hover:border-indigo-300" onClick={() => { void player.unlock(); navigate("/player"); }}>
              <span>
                <span className="block text-xs text-slate-500">Плеер</span>
                {device.eventName}
              </span>
              <span className="text-indigo-600">→</span>
            </button>
          )}
        </div>
      )}

      <footer className="mt-10 text-center text-xs text-slate-400">
        Автор: Барях Лев, ученик 10А класса школы № 9 г. Пермь
      </footer>

      {dialog === "create" && <CreateEventDialog onClose={() => setDialog(null)} />}
      {dialog === "join" && <JoinDialog onClose={() => setDialog(null)} />}
      {dialog === "admin" && <AdminLoginDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

interface UploadItem {
  name: string;
  progress: number;
  error?: string;
  done?: boolean;
}

export async function uploadMany(
  files: File[],
  token: string,
  onChange: (items: UploadItem[]) => void,
): Promise<UploadItem[]> {
  const items: UploadItem[] = files.map((f) => ({ name: f.name, progress: 0 }));
  const emit = () => onChange(items.map((i) => ({ ...i })));
  emit();
  for (let i = 0; i < files.length; i++) {
    try {
      await uploadTrack(files[i], token, (p) => {
        items[i].progress = p;
        emit();
      });
      items[i].done = true;
      items[i].progress = 1;
    } catch (e) {
      items[i].error = e instanceof Error ? e.message : "Ошибка загрузки";
    }
    emit();
  }
  return items;
}

export function UploadList({ items }: { items: UploadItem[] }) {
  if (!items.length) return null;
  return (
    <ul className="max-h-48 space-y-1.5 overflow-y-auto text-sm">
      {items.map((it, i) => (
        <li key={i}>
          <div className="flex justify-between gap-2">
            <span className="truncate">{it.name}</span>
            <span className={it.error ? "text-rose-600" : it.done ? "text-emerald-600" : "text-slate-500"}>
              {it.error ? "ошибка" : it.done ? "готово" : `${Math.round(it.progress * 100)}%`}
            </span>
          </div>
          {it.error ? (
            <div className="text-xs text-rose-600">{it.error}</div>
          ) : (
            <div className="mt-0.5 h-1 rounded bg-slate-100">
              <div className="h-1 rounded bg-indigo-500 transition-all" style={{ width: `${it.progress * 100}%` }} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

export const AUDIO_ACCEPT = ".mp3,.m4a,.aac,.ogg,.oga,.opus,.wav,.flac,.webm,audio/*";

function CreateEventDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayIso);
  const [schedule, setSchedule] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [result, setResult] = useState<CreateEventResult | null>(null);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<CreateEventResult>("/events", {
        body: { name, date, schedule_text: schedule, timezone },
      });
      adminSession.set({ token: res.admin_token, eventName: name.trim() });
      if (files.length) await uploadMany(files, res.admin_token, setUploads);
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось создать событие");
    } finally {
      setBusy(false);
    }
  };

  if (result) {
    const failed = uploads.filter((u) => u.error).length;
    return (
      <Modal title="Событие создано" onClose={() => navigate("/admin")}>
        <div className="space-y-4">
          <CopyField label="Код для подключения устройств" value={result.code} big />
          <p className="-mt-2 text-xs text-slate-500">Действует до {formatDateTime(result.code_expires_at)}. Код можно перегенерировать в управлении.</p>
          <CopyField label="Пароль администратора" value={result.admin_password} />
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Сохраните пароль — он показывается один раз и нужен для входа в управление с других устройств.
          </p>
          {failed > 0 && <ErrorText>Не загружено файлов: {failed}. Их можно догрузить в управлении.</ErrorText>}
          <button className="btn-primary w-full" onClick={() => navigate("/admin")}>
            Перейти к управлению
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title="Новое событие" onClose={busy ? () => undefined : onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Название</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, День знаний" required maxLength={200} autoFocus />
        </div>
        <div>
          <label className="label">Дата</label>
          <DateInput value={date} onChange={setDate} />
          <p className="mt-1 text-xs text-slate-500">Часовой пояс: {timezone} (можно изменить в управлении)</p>
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Расписание перемен</label>
            <label className="cursor-pointer text-sm text-indigo-600 hover:underline">
              Загрузить .txt
              <input
                type="file"
                accept=".txt,text/plain"
                className="hidden"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (f) setSchedule(await f.text());
                  e.target.value = "";
                }}
              />
            </label>
          </div>
          <textarea
            className="input min-h-28 font-mono"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder={"08:45-08:55\n09:40-10:00\n10:45-11:05"}
          />
          <p className="mt-1 text-xs text-slate-500">Каждая строка — перемена в формате HH:MM-HH:MM. Можно оставить пустым.</p>
        </div>
        <div>
          <label className="label">Музыка</label>
          <input
            type="file"
            multiple
            accept={AUDIO_ACCEPT}
            onChange={(e) => setFiles([...(e.target.files ?? [])])}
            className="block w-full text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-50 file:px-3 file:py-2 file:text-indigo-700 hover:file:bg-indigo-100"
          />
          {files.length > 0 && <p className="mt-1 text-xs text-slate-500">Выбрано файлов: {files.length}</p>}
        </div>
        <UploadList items={uploads} />
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy || !name.trim()}>
          {busy ? (uploads.length ? "Загрузка музыки…" : "Создание…") : "Создать"}
        </button>
      </form>
    </Modal>
  );
}

function JoinDialog({ onClose }: { onClose: () => void }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    // Разблокируем звук в момент клика — дальше воспроизведение начнётся без участия пользователя.
    void player.unlock();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ device_token: string; event: { name: string } }>("/join", {
        body: { code, name: name.trim() || describeUserAgent(navigator.userAgent) },
      });
      deviceSession.set({ token: res.device_token, eventName: res.event.name });
      navigate("/player");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось подключиться");
      setBusy(false);
    }
  };

  return (
    <Modal title="Войти в событие" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Код события</label>
          <input
            className="input text-center font-mono text-3xl tracking-[0.5em]"
            inputMode="numeric"
            autoComplete="one-time-code"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            placeholder="000000"
            autoFocus
          />
        </div>
        <div>
          <label className="label">Название устройства (необязательно)</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Холл 2 этажа" maxLength={100} />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy || code.length !== 6}>
          {busy ? "Подключение…" : "Подключиться"}
        </button>
      </form>
    </Modal>
  );
}

function AdminLoginDialog({ onClose }: { onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const res = await api<{ admin_token: string; event_name: string }>("/admin/login", { body: { password } });
      adminSession.set({ token: res.admin_token, eventName: res.event_name });
      navigate("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось войти");
      setBusy(false);
    }
  };

  return (
    <Modal title="Вход администратора" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div>
          <label className="label">Пароль администратора</label>
          <input className="input font-mono" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="16 символов" autoFocus autoComplete="current-password" />
        </div>
        <ErrorText>{error}</ErrorText>
        <button className="btn-primary w-full" disabled={busy || !password.trim()}>
          {busy ? "Вход…" : "Войти"}
        </button>
      </form>
    </Modal>
  );
}

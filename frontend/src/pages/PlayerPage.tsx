import { useEffect, useState } from "react";
import { NowPlaying } from "../components/NowPlaying";
import { OutputControls } from "../components/OutputControls";
import { ConfirmModal } from "../components/Modal";
import { api } from "../lib/api";
import { formatDate } from "../lib/format";
import { player } from "../lib/player";
import { navigate } from "../lib/router";
import { deviceSession } from "../lib/storage";
import { useEventConnection } from "../lib/useEventConnection";
import { usePlayerSnapshot } from "../lib/usePlayer";

function leave(notice?: string) {
  deviceSession.set(null);
  if (notice) sessionStorage.setItem("music.notice", notice);
  navigate("/");
}

export function PlayerPage({ token }: { token: string }) {
  const { state, connected, socket } = useEventConnection(token, (code) =>
    leave(code === 4004 ? "Событие было удалено администратором." : "Устройство отключено от события."),
  );
  const snap = usePlayerSnapshot();
  const [confirmExit, setConfirmExit] = useState(false);

  useEffect(() => {
    player.setEnabled(true);
    return () => player.setEnabled(false);
  }, []);

  // Отчёт о состоянии для списка устройств у администратора.
  useEffect(() => {
    const send = () =>
      socket?.send({
        type: "status",
        status: { playing: player.snapshot.playing, blocked: player.snapshot.blocked, drift_ms: player.snapshot.drift_ms, error: player.snapshot.error },
      });
    send();
    const id = setInterval(send, 5000);
    return () => clearInterval(id);
  }, [socket, connected, snap.playing, snap.blocked, snap.error]);

  // Не даём экрану погаснуть (на мобильных это может остановить звук).
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const request = async () => {
      try {
        if (document.visibilityState === "visible") lock = await navigator.wakeLock?.request("screen");
      } catch {
        /* не поддерживается */
      }
    };
    void request();
    document.addEventListener("visibilitychange", request);
    return () => {
      document.removeEventListener("visibilitychange", request);
      void lock?.release();
    };
  }, []);

  const exit = async () => {
    try {
      await api("/device/me", { method: "DELETE", token });
    } catch {
      /* всё равно выходим */
    }
    leave();
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-6 sm:py-10">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Плеер события</div>
          <h1 className="truncate text-2xl font-bold">{state?.event.name ?? deviceSession.get()?.eventName}</h1>
          {state && <div className="text-sm text-slate-500">{formatDate(state.event.date)}</div>}
        </div>
        <button className="btn-secondary shrink-0" onClick={() => setConfirmExit(true)}>
          Выйти
        </button>
      </header>

      {!connected && (
        <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Нет связи с сервером, переподключаемся…</div>
      )}

      <section className="card">
        {state ? <NowPlaying state={state} /> : <div className="py-8 text-center text-slate-500">Подключение…</div>}
        {snap.error && <p className="mt-3 text-sm text-rose-600">{snap.error}</p>}
        {snap.loading && <p className="mt-3 text-sm text-slate-500">Загрузка трека…</p>}
      </section>

      <section className="card mt-4">
        <OutputControls prefix="player" />
      </section>

      <p className="mt-4 text-center text-xs text-slate-400">
        Держите эту вкладку открытой. Воспроизведением управляет администратор.
      </p>

      {snap.blocked && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm">
          <button className="btn-primary w-full max-w-sm px-8 py-5 text-lg" onClick={() => void player.unlock()}>
            ▶ Нажмите, чтобы включить звук
          </button>
        </div>
      )}

      {confirmExit && (
        <ConfirmModal
          title="Выйти из события?"
          text="Устройство перестанет воспроизводить музыку. Чтобы вернуться, понадобится действующий код события."
          confirmLabel="Выйти"
          onConfirm={() => void exit()}
          onClose={() => setConfirmExit(false)}
        />
      )}
    </div>
  );
}

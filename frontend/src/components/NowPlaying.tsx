import { useState, type PointerEvent } from "react";
import { clock } from "../lib/clock";
import { formatClock, formatDuration, trackLabel } from "../lib/format";
import { useTicker } from "../lib/useEventConnection";
import type { EventState } from "../lib/types";

export function currentPosition(s: EventState): number {
  if (!s.track) return 0;
  const pos = s.playing && s.started_at !== null ? clock.now() - s.started_at : s.position;
  return Math.max(0, Math.min(s.track.duration, pos));
}

export function statusText(s: EventState): string {
  const tz = s.timezone;
  if (s.tracks.filter((t) => t.enabled).length === 0) return "В очереди нет треков";
  if (s.mode === "off") return "Музыка выключена администратором";
  if (s.playing) {
    if (s.mode === "on") return "Играет (принудительно, без расписания)";
    return s.window_end ? `Перемена — музыка до ${formatClock(s.window_end, tz)}` : "Играет";
  }
  if (s.paused) return "Пауза";
  if (s.queue_ended) return "Очередь доиграна — продолжим на следующей перемене";
  if (s.next_start) return `Ожидание перемены в ${formatClock(s.next_start, tz)}`;
  return "Сегодня перемен больше нет";
}

interface Props {
  state: EventState;
  onSeek?: (position: number) => void;
}

export function NowPlaying({ state, onSeek }: Props) {
  useTicker(250);
  // Доля трека под пальцем/курсором во время перетаскивания; перемотка отправляется при отпускании.
  const [drag, setDrag] = useState<number | null>(null);
  const track = state.track;
  const seekable = !!onSeek && !!track;
  const pos = drag !== null && track ? drag * track.duration : currentPosition(state);
  const pct = track ? (pos / track.duration) * 100 : 0;

  const fraction = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  };

  return (
    <div>
      <div className="flex items-center gap-2 text-sm">
        <span className={`h-2.5 w-2.5 rounded-full ${state.playing ? "animate-pulse bg-emerald-500" : "bg-slate-300"}`} />
        <span className="text-slate-600">{statusText(state)}</span>
      </div>
      <div className="mt-3 min-h-[3.5rem]">
        <div className="truncate text-xl font-semibold sm:text-2xl" title={track ? trackLabel(track) : undefined}>
          {track ? trackLabel(track) : "—"}
        </div>
        {state.next_track && state.next_track.id !== track?.id && (
          <div className="mt-1 truncate text-sm text-slate-500">Далее: {trackLabel(state.next_track)}</div>
        )}
        {track?.loop && <div className="mt-1 text-sm text-indigo-600">Трек зациклен</div>}
      </div>
      <div className="mt-3">
        <div
          className={`-my-3 py-3 ${seekable ? "cursor-pointer touch-none" : ""}`}
          onPointerDown={(e) => {
            if (!seekable) return;
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag(fraction(e));
          }}
          onPointerMove={(e) => drag !== null && setDrag(fraction(e))}
          onPointerUp={(e) => {
            if (drag === null || !onSeek || !track) return;
            onSeek(fraction(e) * track.duration);
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
        >
          <div className={`relative overflow-hidden rounded-full bg-slate-200 transition-[height] ${drag !== null ? "h-3" : "h-2"}`}>
            <div className="absolute inset-y-0 left-0 bg-indigo-500" style={{ width: `${pct}%` }} />
          </div>
        </div>
        <div className="mt-1 flex justify-between text-xs tabular-nums text-slate-500">
          <span>{formatDuration(pos)}</span>
          <span>{track ? formatDuration(track.duration) : "0:00"}</span>
        </div>
      </div>
    </div>
  );
}

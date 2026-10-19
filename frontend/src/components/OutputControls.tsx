import { useCallback, useEffect, useState } from "react";
import { player } from "../lib/player";
import { pref, setPref } from "../lib/storage";

/** Ползунок громкости и выбор устройства вывода (настройки хранятся в браузере). */
export function OutputControls({ prefix }: { prefix: string }) {
  const [volume, setVolume] = useState(() => pref(`${prefix}.volume`, 1));
  const [sink, setSink] = useState(() => pref(`${prefix}.sink`, "default"));
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState("");
  const supported = player.snapshot.sinkSupported;

  useEffect(() => {
    player.setVolume(volume);
    setPref(`${prefix}.volume`, volume);
  }, [volume, prefix]);

  const refresh = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const list = await navigator.mediaDevices.enumerateDevices();
    setDevices(list.filter((d) => d.kind === "audiooutput"));
  }, []);

  useEffect(() => {
    if (!supported) return;
    void refresh();
    navigator.mediaDevices?.addEventListener("devicechange", refresh);
    return () => navigator.mediaDevices?.removeEventListener("devicechange", refresh);
  }, [supported, refresh]);

  const apply = useCallback(
    async (id: string) => {
      try {
        await player.setSink(id);
        setSink(id);
        setPref(`${prefix}.sink`, id);
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Не удалось выбрать устройство");
      }
    },
    [prefix],
  );

  // Восстановить сохранённое устройство, если оно доступно.
  useEffect(() => {
    if (supported && sink !== "default" && devices.some((d) => d.deviceId === sink)) void player.setSink(sink).catch(() => undefined);
  }, [supported, sink, devices]);

  const requestLabels = async () => {
    try {
      const md = navigator.mediaDevices as MediaDevices & { selectAudioOutput?: () => Promise<MediaDeviceInfo> };
      if (md.selectAudioOutput) {
        const d = await md.selectAudioOutput();
        await refresh();
        await apply(d.deviceId);
        return;
      }
      const stream = await md.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      await refresh();
    } catch {
      setError("Браузер не дал доступ к списку устройств");
    }
  };

  const hasLabels = devices.some((d) => d.label);

  return (
    <div className="space-y-3">
      <div>
        <label className="label flex items-center justify-between">
          <span>Громкость</span>
          <span className="text-slate-500">{Math.round(volume * 100)}%</span>
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          className="w-full accent-indigo-600"
        />
      </div>
      <div>
        <label className="label">Устройство вывода</label>
        {supported ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select className="input" value={sink} onChange={(e) => void apply(e.target.value)}>
              <option value="default">По умолчанию (системное)</option>
              {devices
                .filter((d) => d.deviceId && d.deviceId !== "default")
                .map((d, i) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label || `Устройство ${i + 1}`}
                  </option>
                ))}
            </select>
            {!hasLabels && (
              <button className="btn-secondary shrink-0" onClick={requestLabels}>
                Показать все устройства
              </button>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">
            Этот браузер не поддерживает выбор устройства вывода — используется системное. Подойдёт Chrome, Edge или Firefox.
          </p>
        )}
        {error && <p className="mt-1 text-sm text-rose-600">{error}</p>}
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { player } from "./player";
import { EventSocket } from "./socket";
import type { DeviceInfo, EventState } from "./types";

export function useEventConnection(token: string | null, onRevoked: (code: number) => void) {
  const [state, setState] = useState<EventState | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [connected, setConnected] = useState(false);
  const [socket, setSocket] = useState<EventSocket | null>(null);
  const revokedRef = useRef(onRevoked);
  revokedRef.current = onRevoked;

  useEffect(() => {
    if (!token) return;
    player.attach(token);
    const s = new EventSocket(token, {
      onState: (st) => {
        setState(st);
        player.setState(st);
      },
      onDevices: setDevices,
      onConnection: setConnected,
      onRevoked: (code) => revokedRef.current(code),
    });
    setSocket(s);
    return () => {
      s.close();
      player.reset();
    };
  }, [token]);

  return { state, devices, connected, socket };
}

/** Текущее время сервера, обновляемое для анимации прогресса. */
export function useTicker(ms = 250): number {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((x) => x + 1), ms);
    return () => clearInterval(id);
  }, [ms]);
  return Date.now();
}

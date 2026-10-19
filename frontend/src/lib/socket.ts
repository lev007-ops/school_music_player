import { clock } from "./clock";
import type { DeviceInfo, EventState } from "./types";

export interface SocketHandlers {
  onState: (state: EventState) => void;
  onDevices?: (devices: DeviceInfo[]) => void;
  onConnection: (connected: boolean) => void;
  /** Токен больше недействителен: 4001 — устройство удалено/вышло, 4004 — событие удалено. */
  onRevoked: (code: number) => void;
}

export class EventSocket {
  private ws: WebSocket | null = null;
  private closed = false;
  private retry = 0;
  private timers: number[] = [];
  private reconnectTimer: number | undefined;

  constructor(private token: string, private handlers: SocketHandlers) {
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(`${proto}//${location.host}/api/ws?t=${encodeURIComponent(this.token)}`);
    this.ws = ws;

    ws.onopen = () => {
      this.retry = 0;
      this.handlers.onConnection(true);
      // Серия быстрых замеров для синхронизации часов, затем — периодически.
      for (let i = 0; i < 6; i++) this.timers.push(window.setTimeout(() => this.ping(), i * 250));
      this.timers.push(window.setInterval(() => this.ping(), 10_000));
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === "pong") clock.addSample(msg.t0, msg.server_time, Date.now() / 1000);
      else if (msg.type === "state") this.handlers.onState(msg.state);
      else if (msg.type === "devices") this.handlers.onDevices?.(msg.devices);
    };
    ws.onclose = (e) => {
      this.clearTimers();
      this.handlers.onConnection(false);
      if (this.closed) return;
      if (e.code === 4001 || e.code === 4004) {
        this.closed = true;
        this.handlers.onRevoked(e.code);
        return;
      }
      const delay = Math.min(10_000, 500 * 2 ** this.retry++);
      this.reconnectTimer = window.setTimeout(() => this.connect(), delay);
    };
  }

  private ping() {
    this.send({ type: "ping", t0: Date.now() / 1000 });
  }

  send(data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(data));
  }

  private clearTimers() {
    this.timers.forEach((t) => {
      clearTimeout(t);
      clearInterval(t);
    });
    this.timers = [];
  }

  close() {
    this.closed = true;
    this.clearTimers();
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

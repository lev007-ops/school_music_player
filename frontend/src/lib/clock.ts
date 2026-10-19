/** Оценка смещения часов сервера относительно клиента по NTP-подобным замерам. */
export class ServerClock {
  private samples: { offset: number; rtt: number }[] = [];
  offset = 0;

  addSample(t0: number, serverTime: number, t1: number) {
    const rtt = t1 - t0;
    this.samples.push({ offset: serverTime - (t0 + t1) / 2, rtt });
    if (this.samples.length > 12) this.samples.shift();
    // Замер с минимальной задержкой — самый точный.
    const best = this.samples.reduce((a, b) => (b.rtt < a.rtt ? b : a));
    this.offset = best.offset;
  }

  /** Текущее время сервера, секунды unix time. */
  now(): number {
    return Date.now() / 1000 + this.offset;
  }
}

export const clock = new ServerClock();

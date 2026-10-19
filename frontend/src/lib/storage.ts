export interface Session {
  token: string;
  eventName: string;
}

const ADMIN_KEY = "music.admin";
const DEVICE_KEY = "music.device";

function read(key: string): Session | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: Session | null) {
  try {
    if (value) localStorage.setItem(key, JSON.stringify(value));
    else localStorage.removeItem(key);
  } catch {
    /* приватный режим */
  }
}

export const adminSession = { get: () => read(ADMIN_KEY), set: (s: Session | null) => write(ADMIN_KEY, s) };
export const deviceSession = { get: () => read(DEVICE_KEY), set: (s: Session | null) => write(DEVICE_KEY, s) };

export function pref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`music.pref.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function setPref(key: string, value: unknown) {
  try {
    localStorage.setItem(`music.pref.${key}`, JSON.stringify(value));
  } catch {
    /* приватный режим */
  }
}

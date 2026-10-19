import type { Track } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json();
    if (typeof data.detail === "string") return data.detail;
    if (Array.isArray(data.detail)) return data.detail.map((d: { msg: string }) => d.msg).join("; ");
  } catch {
    /* не JSON */
  }
  return `Ошибка сервера (${res.status})`;
}

interface Options {
  method?: string;
  body?: unknown;
  form?: FormData;
  token?: string | null;
}

export async function api<T = void>(path: string, opts: Options = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method: opts.method ?? (body ? "POST" : "GET"), headers, body });
  } catch {
    throw new ApiError(0, "Нет связи с сервером");
  }
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  if (res.status === 204) return undefined as T;
  const type = res.headers.get("content-type") ?? "";
  return (type.includes("json") ? res.json() : res.text()) as Promise<T>;
}

export function uploadTrack(file: File, token: string, onProgress: (fraction: number) => void): Promise<Track> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/admin/tracks");
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data: { detail?: string } & Partial<Track> = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        /* пусто */
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as Track);
      else reject(new ApiError(xhr.status, typeof data.detail === "string" ? data.detail : `Ошибка загрузки (${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "Нет связи с сервером"));
    const form = new FormData();
    form.append("file", file);
    xhr.send(form);
  });
}

export async function downloadFile(path: string, token: string, filename: string): Promise<void> {
  const res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

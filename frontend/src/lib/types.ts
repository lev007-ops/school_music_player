export type Mode = "auto" | "on" | "off";
export type RepeatMode = "all" | "one" | "off";

export interface Track {
  id: number;
  title: string;
  artist: string;
  duration: number;
  loop: boolean;
  enabled: boolean;
  order: number;
  original_name: string;
}

export interface BreakItem {
  start: string;
  end: string;
}

export interface EventState {
  event: { id: number; name: string; date: string };
  mode: Mode;
  repeat_mode: RepeatMode;
  paused: boolean;
  playing: boolean;
  track: Track | null;
  started_at: number | null;
  position: number;
  next_track: Track | null;
  window_active: boolean;
  window_end: number | null;
  next_start: number | null;
  queue_ended: boolean;
  tracks: Track[];
  breaks: BreakItem[];
  timezone: string;
}

export interface DeviceStatus {
  playing?: boolean;
  blocked?: boolean;
  drift_ms?: number | null;
  error?: string | null;
  listening?: boolean;
}

export interface DeviceInfo {
  id: number;
  name: string;
  user_agent: string;
  created_at: number;
  last_seen_at: number;
  online: boolean;
  status: DeviceStatus | null;
}

export interface EventInfo {
  id: number;
  name: string;
  date: string;
  code: string;
  code_expires_at: number;
  code_expired: boolean;
  created_at: number;
  timezone: string;
}

export interface CreateEventResult {
  event_id: number;
  code: string;
  code_expires_at: number;
  admin_password: string;
  admin_token: string;
}

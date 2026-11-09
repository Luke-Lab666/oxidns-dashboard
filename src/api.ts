// Thin client for the OxiDNS management HTTP API.
// Every route lives under `<base>/...`; when the page is served next to OxiDNS
// (or behind a reverse proxy) the base is simply `/api`.

export interface Conn {
  base: string;
  user: string;
  pass: string;
}

const STORE_KEY = "oxidns-dashboard.conn";

function load(): Conn {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return { base: "/api", user: "", pass: "", ...JSON.parse(raw) };
  } catch {
    /* storage unavailable */
  }
  return { base: "/api", user: "", pass: "" };
}

export const conn: Conn = load();

export function saveConn(next: Conn, remember: boolean) {
  Object.assign(conn, next);
  try {
    if (remember) localStorage.setItem(STORE_KEY, JSON.stringify(conn));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export function forgetConn() {
  conn.pass = "";
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

export class ApiError extends Error {
  status: number;
  code?: string;
  body?: any;
  constructor(message: string, status: number, code?: string, body?: any) {
    super(message);
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export function url(path: string) {
  return conn.base.replace(/\/+$/, "") + path;
}

export function headers(extra: Record<string, string> = {}) {
  const h: Record<string, string> = { Accept: "application/json", ...extra };
  if (conn.user) h.Authorization = "Basic " + btoa(unescape(encodeURIComponent(`${conn.user}:${conn.pass}`)));
  return h;
}

type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(q?: Query) {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function req<T = any>(
  method: string,
  path: string,
  opts: { query?: Query; json?: unknown; body?: BodyInit; signal?: AbortSignal; text?: boolean; silent401?: boolean } = {},
): Promise<T> {
  const h = headers(opts.json !== undefined ? { "Content-Type": "application/json" } : {});
  if (opts.text) h.Accept = "text/plain";
  let res: Response;
  try {
    res = await fetch(url(path) + qs(opts.query), {
      method,
      headers: h,
      body: opts.json !== undefined ? JSON.stringify(opts.json) : opts.body,
      signal: opts.signal,
      cache: "no-store",
    });
  } catch (e: any) {
    if (e?.name === "AbortError") throw e;
    throw new ApiError("无法连接到 OxiDNS API（网络错误或跨域被拦截）", 0);
  }
  if (res.status === 401) {
    if (!opts.silent401) onUnauthorized();
    throw new ApiError("需要登录或凭据错误", 401);
  }
  const raw = await res.text();
  if (opts.text && res.ok) return raw as unknown as T;
  let body: any = undefined;
  try {
    body = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    if (!res.ok) throw new ApiError(`HTTP ${res.status}: ${raw.slice(0, 160)}`, res.status);
    throw new ApiError("响应不是有效的 JSON", res.status);
  }
  if (!res.ok) {
    throw new ApiError(body?.message || body?.error || `HTTP ${res.status}`, res.status, body?.code || body?.error, body);
  }
  return body as T;
}

export const get = <T = any>(p: string, query?: Query, signal?: AbortSignal) => req<T>("GET", p, { query, signal });
export const post = <T = any>(p: string, json?: unknown) => req<T>("POST", p, { json });
export const del = <T = any>(p: string, json?: unknown) => req<T>("DELETE", p, { json });
export const plugin = (tag: string, sub: string) => `/plugins/${encodeURIComponent(tag)}${sub}`;

// ---------- typed shapes (subset of what the backend returns) ----------

export interface Reload {
  status: string;
  pending: boolean;
  in_progress: boolean;
  last_started_ms?: number;
  last_completed_ms?: number;
  last_success_ms?: number;
  last_error?: string;
  running_version?: string;
}

export interface Health {
  status: string;
  version: string;
  build_bundle?: string;
  uptime_ms: number;
  checks: Record<string, string>;
  plugins: { total: number; servers: number };
}

export interface BuildInfo {
  version: string;
  bundle: string;
  enabled_bundles: string[];
  enabled_features: string[];
  supported_plugins: { servers: string[]; executors: string[]; matchers: string[]; providers: string[] };
}

export interface SystemInfo {
  version: string;
  build?: BuildInfo;
  os: string;
  arch: string;
  uptime_ms: number;
  config_path: string;
  reload: Reload;
  process_cpu_percent?: number;
  process_memory_mb?: number;
  process_memory_kind?: string;
  system_memory_total_mb?: number;
}

export interface RecordPayload {
  name: string;
  class: string;
  ttl: number;
  rr_type: string;
  payload_text: string;
}

export interface QueryRecord {
  id: number;
  created_at_ms: number;
  elapsed_ms: number;
  client_ip: string;
  questions_json: { name: string; qtype: string; qclass: string }[];
  error?: string;
  has_response: boolean;
  rcode?: string;
  answer_count: number;
  answers_json: RecordPayload[];
  authorities_json: RecordPayload[];
  additionals_json: RecordPayload[];
  steps?: { event_index: number; sequence_tag: string; node_index?: number; kind: string; tag?: string; outcome: string }[];
}

export interface CacheEntry {
  id: string;
  domain: string;
  record_type: string;
  rcode: string;
  answer_count: number;
  ttl: number;
  remaining_ttl: number;
  fresh: boolean;
  stale: boolean;
  cache_time_unix_ms?: number;
  last_access_unix_ms?: number;
  answers_json?: RecordPayload[];
}

export interface LogEntry {
  id: number;
  timestamp: string;
  level: "ERROR" | "WARN" | "INFO" | "DEBUG" | "TRACE";
  target: string;
  message: string;
}

export async function streamLogs(
  params: { level?: string; tail?: number },
  onEntry: (e: LogEntry) => void,
  signal: AbortSignal,
) {
  const res = await fetch(url("/logs/stream") + qs(params), {
    headers: headers({ Accept: "text/event-stream" }),
    signal,
  });
  if (res.status === 401) {
    onUnauthorized();
    throw new ApiError("需要登录", 401);
  }
  if (!res.ok || !res.body) throw new ApiError(`HTTP ${res.status}`, res.status);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const blocks = buf.split("\n\n");
    buf = blocks.pop() ?? "";
    for (const b of blocks)
      for (const line of b.split("\n"))
        if (line.startsWith("data:")) {
          try {
            onEntry(JSON.parse(line.slice(5).trim()));
          } catch {
            /* skip malformed frame */
          }
        }
  }
}

// Minimal mock of the OxiDNS management API for UI development.
//   node mock/server.mjs            -> http://127.0.0.1:9199  (serves dist/ + /api/*)
// Set MOCK_AUTH=admin:secret to require Basic auth.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist");
const PORT = Number(process.env.PORT ?? 9199);
const AUTH = process.env.MOCK_AUTH ? "Basic " + Buffer.from(process.env.MOCK_AUTH).toString("base64") : null;
const started = Date.now() - 3 * 86400_000 - 5 * 3600_000;

let config = `log:
  level: info

api:
  http:
    listen: ":9199"

plugins:
  # Upstreams
  - tag: forward_cn
    type: forward
    args:
      upstreams:
        - addr: "223.5.5.5"
        - addr: "119.29.29.29"
  - tag: forward_global
    type: forward
    args:
      upstreams:
        - addr: "tls://1.1.1.1"
        - addr: "https://dns.google/dns-query"

  - tag: main_cache
    type: cache
    args:
      size: 8192
      lazy_cache_ttl: 86400

  - tag: recorder
    type: query_recorder
    args:
      path: "./data/query-recorder.sqlite"

  - tag: geosite_cn
    type: domain_set
    args:
      files: ["./data/geosite-cn.txt"]
  - tag: ad_block
    type: dynamic_domain_set
    args: {}
  - tag: is_cn
    type: qname
    args: ["$geosite_cn"]
  - tag: is_ad
    type: qname
    args: ["$ad_block"]

  - tag: update_rules
    type: download
    args:
      downloads:
        - url: https://example.com/geosite-cn.txt
          path: ./data/geosite-cn.txt
  - tag: daily
    type: cron
    args:
      jobs:
        - name: refresh_rules
          schedule: "0 4 * * *"
          executors: [$update_rules]

  - tag: main_sequence
    type: sequence
    args:
      - exec: $recorder
      - matches: $is_ad
        exec: reject 3
      - exec: $main_cache
      - matches: $is_cn
        exec: $forward_cn
      - matches: "!$is_cn"
        exec: $forward_global
      - exec: accept

  - tag: udp_server
    type: udp_server
    args:
      entry: main_sequence
      listen: ":53"
  - tag: tcp_server
    type: tcp_server
    args:
      entry: main_sequence
      listen: ":53"
`;
let version = "a1b2c3d4e5f6";

const domains = ["www.baidu.com.", "api.github.com.", "www.google.com.", "mirrors.tuna.tsinghua.edu.cn.", "i0.hdslb.com.", "graph.facebook.com.", "time.apple.com.", "dns.msftncsi.com.", "connectivitycheck.gstatic.com.", "ad.doubleclick.net.", "cdn.jsdelivr.net.", "www.bilibili.com.", "weixin.qq.com.", "push.apple.com.", "update.googleapis.com.", "registry.npmjs.org.", "pages.github.io.", "static.zhihu.com."];
const clients = ["192.168.1.10", "192.168.1.23", "192.168.1.45", "192.168.1.101", "fd00::1a2b", "10.0.0.8"];
const qtypes = ["A", "A", "A", "AAAA", "AAAA", "HTTPS", "CNAME", "TXT"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

let records = [];
let rid = 1;
function makeRecord(t) {
  const name = pick(domains), qtype = pick(qtypes), ad = name.startsWith("ad.");
  const err = Math.random() < 0.01;
  const rcode = ad ? "NXDOMAIN" : Math.random() < 0.03 ? "SERVFAIL" : "NOERROR";
  const answers = rcode === "NOERROR" && !err
    ? [
        ...(Math.random() < 0.3 ? [{ name, class: "IN", ttl: 300, rr_type: "CNAME", payload_kind: "name", payload_text: "edge." + name.split(".").slice(-3).join("."), payload: null }] : []),
        ...Array.from({ length: rint(1, 3) }, () => ({ name, class: "IN", ttl: rint(30, 600), rr_type: qtype === "AAAA" ? "AAAA" : "A", payload_kind: "ip", payload_text: qtype === "AAAA" ? `2408:8000::${rint(1, 9999).toString(16)}` : `${rint(1, 223)}.${rint(0, 255)}.${rint(0, 255)}.${rint(1, 254)}`, payload: null })),
      ]
    : [];
  return {
    id: rid++, created_at_ms: t, elapsed_ms: Math.random() < 0.6 ? Math.random() * 2 : Math.random() < 0.9 ? rint(8, 80) + Math.random() : rint(200, 1500),
    request_id: rid, client_ip: pick(clients), questions_json: [{ name, qtype, qclass: "IN" }],
    error: err ? "upstream timeout after 5s" : undefined, has_response: !err, rcode: err ? undefined : rcode,
    answer_count: answers.length, authority_count: 0, additional_count: 0, answers_json: answers, authorities_json: [], additionals_json: [], signature_json: [],
  };
}
for (let t = Date.now() - 7 * 86400_000; t < Date.now(); t += t > Date.now() - 2 * 3600_000 ? rint(500, 2500) : rint(20_000, 120_000)) records.push(makeRecord(t));
setInterval(() => { if (Math.random() < 0.6) records.push(makeRecord(Date.now())); }, 1000);

let cacheEntries = domains.flatMap((d, i) => ["A", "AAAA"].map((rt, j) => ({
  id: `${i}-${j}`, domain: d, record_type: rt, dns_class: "IN", rcode: d.startsWith("ad.") ? "NXDOMAIN" : "NOERROR", answer_count: rint(0, 3), ttl: 600, remaining_ttl: rint(0, 600),
  fresh: true, stale: false, cache_time_ms: 0, expire_at_ms: 0, last_access_ms: 0, cache_time_unix_ms: Date.now() - rint(1000, 600000), last_access_unix_ms: Date.now() - rint(1000, 100000),
  do_bit: false, cd_bit: false, answers_json: [{ name: d, class: "IN", ttl: 300, rr_type: rt, payload_text: rt === "A" ? "1.2.3.4" : "2001:db8::1" }],
})));
cacheEntries.slice(-3).forEach((e) => { e.stale = true; e.fresh = false; e.remaining_ttl = 0; });
let adRules = ["domain:doubleclick.net", "domain:googlesyndication.com", "full:ad.example.com"];
const modes = { is_cn: "normal", is_ad: "normal" };
let reqCount = 1_284_331;
setInterval(() => (reqCount += rint(20, 90)), 1000);

function filtered(q) {
  const since = Number(q.get("since_ms") ?? 0);
  return records.filter((r) => r.created_at_ms >= since
    && (!q.get("qname") || r.questions_json[0].name.includes(q.get("qname")))
    && (!q.get("client_ip") || r.client_ip.includes(q.get("client_ip")))
    && (!q.get("qtype") || r.questions_json[0].qtype === q.get("qtype"))
    && (!q.get("rcode") || r.rcode === q.get("rcode"))
    && (!q.get("status") || (q.get("status") === "error" ? r.error : q.get("status") === "no_response" ? !r.has_response : r.has_response)));
}
const top = (list, key, limit) => {
  const m = new Map();
  for (const r of list) m.set(key(r), (m.get(key(r)) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([k, c]) => ({ key: k, count: c, share: c / (list.length || 1) }));
};

function metrics() {
  const L = [];
  const add = (n, labels, v) => L.push(`${n}{${Object.entries(labels).map(([k, x]) => `${k}="${x}"`).join(",")}} ${v}`);
  add("server_request_total", { plugin_tag: "udp_server" }, reqCount);
  add("server_request_total", { plugin_tag: "tcp_server" }, Math.round(reqCount * 0.02));
  add("server_failed_total", { plugin_tag: "udp_server" }, Math.round(reqCount * 0.0012));
  add("server_latency_sum_ms", { plugin_tag: "udp_server" }, reqCount * 6.4);
  add("server_latency_count", { plugin_tag: "udp_server" }, reqCount);
  add("cache_lookup_total", { plugin_tag: "main_cache" }, reqCount);
  add("cache_hit_total", { plugin_tag: "main_cache" }, Math.round(reqCount * 0.712));
  add("cache_miss_total", { plugin_tag: "main_cache" }, Math.round(reqCount * 0.288));
  add("cache_insert_total", { plugin_tag: "main_cache" }, Math.round(reqCount * 0.25));
  add("cache_expired_total", { plugin_tag: "main_cache" }, Math.round(reqCount * 0.2));
  add("cache_lazy_refresh_total", { plugin_tag: "main_cache" }, Math.round(reqCount * 0.05));
  add("cache_entry_count", { plugin_tag: "main_cache" }, cacheEntries.length * 180);
  const ups = { forward_cn: [["223.5.5.5", 0.6, 9, 0.999], ["119.29.29.29", 0.4, 14, 0.995]], forward_global: [["tls://1.1.1.1", 0.7, 48, 0.991], ["https://dns.google/dns-query", 0.3, 87, 0.94]] };
  for (const [tag, list] of Object.entries(ups)) {
    const base = reqCount * (tag === "forward_cn" ? 0.2 : 0.09);
    add("forward_query_total", { plugin_tag: tag }, Math.round(base));
    add("forward_success_total", { plugin_tag: tag }, Math.round(base * 0.99));
    add("forward_latency_sum_ms", { plugin_tag: tag }, base * list[0][2]);
    add("forward_latency_count", { plugin_tag: tag }, Math.round(base));
    for (const [up, share, lat, ok] of list) {
      const q = Math.round(base * share);
      add("forward_upstream_query_total", { plugin_tag: tag, upstream: up }, q);
      add("forward_upstream_success_total", { plugin_tag: tag, upstream: up }, Math.round(q * ok));
      add("forward_upstream_error_total", { plugin_tag: tag, upstream: up }, Math.round(q * (1 - ok) * 0.4));
      add("forward_upstream_timeout_total", { plugin_tag: tag, upstream: up }, Math.round(q * (1 - ok) * 0.6));
      add("forward_upstream_latency_sum_ms", { plugin_tag: tag, upstream: up }, q * lat);
      add("forward_upstream_latency_count", { plugin_tag: tag, upstream: up }, q);
    }
  }
  add("download_success_total", { plugin_tag: "update_rules" }, 12);
  add("download_failure_total", { plugin_tag: "update_rules" }, 1);
  add("cron_job_run_total", { plugin_tag: "daily", name: "refresh_rules" }, 3);
  return L.join("\n") + "\n";
}

const logs = [];
let lid = 1;
const logMsgs = [["INFO", "oxidns::plugin::executor::forward", "upstream 223.5.5.5 healthy, rtt=8ms"], ["DEBUG", "oxidns::plugin::executor::cache", "cache hit www.baidu.com. A"], ["INFO", "oxidns::app::bootstrap", "plugin init completed: 14 plugins"], ["WARN", "oxidns::plugin::executor::forward", "upstream https://dns.google/dns-query timeout after 5s"], ["ERROR", "oxidns::plugin::executor::download", "download https://example.com/geosite-cn.txt failed: connection reset"], ["TRACE", "oxidns::plugin::server::udp", "recv 64 bytes from 192.168.1.10:53122"]];
const lvlRank = { TRACE: 0, DEBUG: 1, INFO: 2, WARN: 3, ERROR: 4 };
function mkLog() { const [level, target, message] = pick(logMsgs); return { id: lid++, timestamp: new Date().toISOString(), elapsed_ms: Date.now() - started, level, target, message }; }
for (let i = 0; i < 200; i++) logs.push(mkLog());
const streams = new Set();
setInterval(() => { const e = mkLog(); logs.push(e); if (logs.length > 1000) logs.shift(); for (const s of streams) if (lvlRank[e.level] >= lvlRank[s.level]) s.res.write(`data: ${JSON.stringify(e)}\n\n`); }, 700);

let reload = { status: "idle", pending: false, in_progress: false, last_success_ms: Date.now() - 3600_000, last_completed_ms: Date.now() - 3600_000, running_version: version };

const json = (res, code, body) => { res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }); res.end(JSON.stringify(body)); };
const ok = (res, body = {}) => json(res, 200, { ok: true, ...body });

async function body(req) { let s = ""; for await (const c of req) s += c; try { return JSON.parse(s || "{}"); } catch { return {}; } }

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (!u.pathname.startsWith("/api")) {
    let p = path.join(root, u.pathname === "/" ? "index.html" : u.pathname);
    if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) p = path.join(root, "index.html");
    res.writeHead(200, { "Content-Type": p.endsWith(".html") ? "text/html; charset=utf-8" : "application/octet-stream" });
    return fs.createReadStream(p).pipe(res);
  }
  if (req.method === "OPTIONS") { res.writeHead(204, { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*", "Access-Control-Allow-Methods": "*" }); return res.end(); }
  if (AUTH && req.headers.authorization !== AUTH) return json(res, 401, { ok: false, message: "unauthorized" });
  const p = u.pathname.slice(4), q = u.searchParams, M = req.method;
  await new Promise((r) => setTimeout(r, rint(20, 120)));

  if (p === "/health") return json(res, 200, { status: "ok", version: "0.9.3", build_bundle: "standard", uptime_ms: Date.now() - started, checks: { api: "ok", plugin_init: "ok", server_startup: "ok" }, plugins: { total: 14, servers: 2 } });
  if (p === "/build") return ok(res, { build: { version: "0.9.3", bundle: "standard", enabled_bundles: ["standard"], enabled_features: ["api", "webui", "metrics", "plugin-upgrade", "plugin-cron", "plugin-download", "plugin-dynamic-domain", "plugin-query-recorder", "server-doh", "upstream-dot"], supported_plugins: { servers: ["udp_server", "tcp_server", "http_server"], executors: ["forward", "cache", "sequence", "query_recorder", "download", "cron", "hosts"], matchers: ["qname", "qtype", "client_ip"], providers: ["domain_set", "ip_set", "dynamic_domain_set", "geosite"] } } });
  if (p === "/system") return ok(res, { version: "0.9.3", os: "linux", arch: "x86_64", uptime_ms: Date.now() - started, config_path: "/etc/oxidns/config.yaml", api_enabled: true, reload, process_cpu_percent: 1.5 + Math.random() * 3, process_memory_mb: 38.2 + Math.random(), process_memory_kind: "rss", system_memory_total_mb: 3934 });
  if (p === "/metrics") { res.writeHead(200, { "Content-Type": "text/plain" }); return res.end(metrics()); }
  if (p === "/config" && M === "GET") return ok(res, { path: "/etc/oxidns/config.yaml", format: "yaml", content: config, version, updated_at_ms: Date.now() - 7200_000 });
  if (p === "/config" && M === "PUT") {
    const b = await body(req);
    if (b.base_version && b.base_version !== version) return json(res, 409, { ok: false, message: "config changed on disk" });
    if (!b.content.includes("plugins:")) return json(res, 400, { ok: false, message: "config validation failed", diagnostics: ["missing plugins"], diagnostic_details: [{ message: "missing field `plugins`", severity: "error", line: 1, column: 1, end_line: 1, end_column: 2 }] });
    config = b.content; version = Math.random().toString(16).slice(2, 14);
    if (b.reload) doReload();
    return ok(res, { path: "/etc/oxidns/config.yaml", format: "yaml", version, plugin_count: 14, init_order: [], message: "saved" });
  }
  if (p === "/config/validate") {
    const b = await body(req);
    const bad = b.content.split("\n").findIndex((l) => /\btype:\s*nope\b/.test(l));
    if (bad >= 0) return json(res, 400, { ok: false, message: "配置校验失败", diagnostics: ["unknown plugin type `nope`"], diagnostic_details: [{ message: "unknown plugin type `nope`", severity: "error", line: bad + 1, column: 11, end_line: bad + 1, end_column: 15 }] });
    return ok(res, { source: "body", plugin_count: 14, dependency_graph: { nodes: [], edges: [], init_order: [] }, message: "valid" });
  }
  if (p === "/reload" && M === "POST") { doReload(); return ok(res, { status: "accepted" }); }
  if (p === "/reload/status") return json(res, 200, reload);
  if (p === "/restart") return ok(res, { status: "accepted" });
  if (p === "/logs") { const lv = q.get("level") ?? "TRACE"; const list = logs.filter((e) => lvlRank[e.level] >= lvlRank[lv]); return ok(res, { total: list.length, entries: list.slice(-Number(q.get("limit") ?? 200)) }); }
  if (p === "/logs/stream") { res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" }); const s = { res, level: q.get("level") ?? "INFO" }; streams.add(s); req.on("close", () => streams.delete(s)); return; }
  if (p === "/upgrade/check") return ok(res, { current_version: "0.9.3", latest_version: "0.9.4", update_available: true, asset_name: "oxidns-x86_64-unknown-linux-musl.tar.gz", release_url: "https://github.com/svenshi/oxidns/releases" });
  if (p === "/upgrade/apply") return ok(res, { action: "upgrade", status: "started", message: "ok" });
  if (p === "/upgrade/status") return ok(res, { state: "completed" });

  const m = /^\/plugins\/([^/]+)(\/.*)$/.exec(p);
  if (m) {
    const [, tag, sub] = m;
    if (tag === "recorder") {
      if (sub === "/records" && M === "GET") {
        const list = filtered(q).slice().reverse();
        const start = Number(q.get("cursor") ?? 0), lim = Number(q.get("limit") ?? 100);
        return ok(res, { records: list.slice(start, start + lim), next_cursor: start + lim < list.length ? String(start + lim) : undefined });
      }
      if (sub === "/records" && M === "DELETE") { const n = records.length; records = []; return ok(res, { cleared_records: n }); }
      const rd = /^\/records\/(\d+)$/.exec(sub);
      if (rd) { const r = records.find((x) => x.id === Number(rd[1])); return r ? ok(res, { record: { ...r, steps: [{ event_index: 0, sequence_tag: "main_sequence", node_index: 0, kind: "executor", tag: "recorder", outcome: "executed" }, { event_index: 1, sequence_tag: "main_sequence", node_index: 1, kind: "matcher", tag: "is_ad", outcome: r.rcode === "NXDOMAIN" ? "matched" : "not_matched" }, { event_index: 2, sequence_tag: "main_sequence", node_index: 2, kind: "executor", tag: "main_cache", outcome: "executed" }, { event_index: 3, sequence_tag: "main_sequence", node_index: 3, kind: "matcher", tag: "is_cn", outcome: "matched" }, { event_index: 4, sequence_tag: "main_sequence", node_index: 3, kind: "executor", tag: "forward_cn", outcome: "executed" }, { event_index: 5, sequence_tag: "main_sequence", node_index: 5, kind: "builtin", tag: "accept", outcome: "accept" }] } }) : json(res, 404, { message: "not found" }); }
      const list = filtered(q);
      if (sub === "/stats/top_qnames") return ok(res, { sample_size: list.length, rows: top(list, (r) => r.questions_json[0].name, Number(q.get("limit") ?? 10)) });
      if (sub === "/stats/top_clients") return ok(res, { sample_size: list.length, rows: top(list, (r) => r.client_ip, Number(q.get("limit") ?? 10)) });
      if (sub === "/stats/qtype") return ok(res, { sample_size: list.length, rows: top(list, (r) => r.questions_json[0].qtype, 20) });
      if (sub === "/stats/rcode") return ok(res, { sample_size: list.length, rows: top(list, (r) => r.error ? "ERROR" : r.rcode, 20) });
      if (sub === "/stats/latency") { const v = list.map((r) => r.elapsed_ms).sort((a, b) => a - b); const P = (x) => v[Math.min(v.length - 1, Math.floor(v.length * x))] ?? 0; return ok(res, { sample_size: v.length, avg_ms: v.reduce((a, b) => a + b, 0) / (v.length || 1), p50_ms: P(0.5), p95_ms: P(0.95), p99_ms: P(0.99), max_ms: v.at(-1) ?? 0, histogram: [], slow_top: [] }); }
      if (sub === "/stats/timeseries") {
        const bms = q.get("bucket") === "hour" ? 3600_000 : 60_000; const map = new Map();
        for (const r of list) { const b = Math.floor(r.created_at_ms / bms) * bms; const x = map.get(b) ?? { bucket_ms: b, total: 0, error_count: 0, no_response_count: 0, avg_ms: 0, p95_ms: 0 }; x.total++; if (r.error) x.error_count++; x.avg_ms += r.elapsed_ms; map.set(b, x); }
        // Inflate counts so charts look like real traffic.
        const pts = [...map.values()].map((x) => ({ ...x, total: x.total * (bms > 60000 ? 3 : 18) + rint(0, 10), error_count: x.error_count * 6, avg_ms: x.avg_ms / x.total, p95_ms: x.avg_ms / x.total * 3 }));
        return ok(res, { sample_size: list.length, bucket_ms: bms, points: pts });
      }
    }
    if (tag === "main_cache") {
      if (sub === "/entries") { const qn = q.get("qname"); const list = cacheEntries.filter((e) => !qn || e.domain.includes(qn)); return ok(res, { entries: list, total_entries: list.length }); }
      const de = /^\/entries\/(.+)$/.exec(sub);
      if (de && M === "DELETE") { cacheEntries = cacheEntries.filter((e) => e.id !== decodeURIComponent(de[1])); return ok(res); }
      if (sub === "/flush") { cacheEntries = []; return ok(res); }
    }
    if (modes[tag] !== undefined) {
      if (sub === "/status") return ok(res, { matcher: tag, mode: modes[tag] });
      if (sub === "/mode") { modes[tag] = (await body(req)).mode; return ok(res, { matcher: tag, mode: modes[tag] }); }
    }
    if (tag === "geosite_cn" && sub === "/reload") return ok(res, { action: "reload_provider", provider: tag, status: "reloaded" });
    if (tag === "ad_block") {
      if (sub === "/rules" && M === "GET") return ok(res, { total: adRules.length, next_cursor: null, rules: adRules });
      if (sub === "/rules" && M === "POST") { const b = await body(req); const add = b.rules.map((r) => `${b.rule_kind ?? "domain"}:${r}`); adRules.push(...add); return ok(res, { added: add.length, removed: 0, total: adRules.length }); }
      if (sub === "/rules" && M === "DELETE") { const b = await body(req); adRules = adRules.filter((r) => !b.rules.includes(r)); return ok(res, { added: 0, removed: 1, total: adRules.length }); }
      if (sub === "/rules/clear") { adRules = []; return ok(res, { added: 0, removed: 0, total: 0 }); }
    }
    if (tag === "daily") {
      if (sub === "/jobs/status") return ok(res, { jobs: { refresh_rules: { current_run: null, last_manual_run: { run_id: 3, status: "completed", executor_error_count: 0, completed_at_ms: Date.now() - 86400_000 } } } });
      if (sub.startsWith("/jobs/")) return ok(res, { job: "refresh_rules", status: "started", trigger: "manual", run_id: 4 });
    }
    if (tag === "update_rules") {
      if (sub === "/downloads") return ok(res, { running: false, downloads: [{ index: 0, url: "https://example.com/geosite-cn.txt", path: "./data/geosite-cn.txt" }] });
      if (sub === "/download") return ok(res, { total: 1, succeeded: 1, failed: 0 });
    }
  }
  json(res, 404, { ok: false, message: `no route ${M} ${p}` });
}).listen(PORT, () => console.log(`mock oxidns on http://127.0.0.1:${PORT}`));

function doReload() {
  reload = { ...reload, pending: false, in_progress: true, last_started_ms: Date.now() };
  setTimeout(() => { reload = { ...reload, in_progress: false, last_completed_ms: Date.now(), last_success_ms: Date.now(), last_error: undefined, running_version: version }; }, 1500);
}

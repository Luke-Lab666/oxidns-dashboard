import { get, plugin, type SystemInfo } from "../api";
import { loadMetrics, pluginsOfKind, state, sum, type Sample } from "../state";
import { barChart, compact, dur, esc, icon, ms, num, pct, rankList, sparkline, type SeriesPoint } from "../ui";
import type { Page } from "./page";

const RANGES = {
  "1h": { label: "1 小时", span: 3600_000, bucket: "minute", buckets: 60 },
  "6h": { label: "6 小时", span: 6 * 3600_000, bucket: "minute", buckets: 360 },
  "24h": { label: "24 小时", span: 86400_000, bucket: "hour", buckets: 24 },
  "7d": { label: "7 天", span: 7 * 86400_000, bucket: "hour", buckets: 168 },
} as const;
type RangeKey = keyof typeof RANGES;

let range: RangeKey = "1h";
let recorderTag = "";
const qpsHistory: number[] = [];
let lastReq: { t: number; v: number } | null = null;

export const overview: Page = {
  title: "概览",
  mount(root) {
    const recorders = pluginsOfKind("query_recorder");
    if (!recorders.find((r) => r.tag === recorderTag)) recorderTag = recorders[0]?.tag ?? "";

    root.innerHTML = `
      <section class="stats" id="ov-stats">${skeletonStats()}</section>
      <section class="grid-2" id="ov-mid">
        <div class="card" id="ov-upstreams"><div class="card-h"><h2>${icon("globe")}上游</h2></div><div class="card-b"><div class="skel" style="height:120px"></div></div></div>
        <div class="card" id="ov-sys"><div class="card-h"><h2>${icon("cpu")}系统</h2></div><div class="card-b"><div class="skel" style="height:120px"></div></div></div>
      </section>
      ${
        recorders.length
          ? `<section class="card" id="ov-rec">
              <div class="card-h">
                <h2>${icon("layers")}查询分析</h2>
                <div class="row gap">
                  ${recorders.length > 1 ? `<select id="ov-recsel" class="sm">${recorders.map((r) => `<option ${r.tag === recorderTag ? "selected" : ""}>${esc(r.tag)}</option>`).join("")}</select>` : ""}
                  <div class="seg" id="ov-range">${(Object.keys(RANGES) as RangeKey[]).map((k) => `<button data-r="${k}" class="${k === range ? "on" : ""}">${RANGES[k].label}</button>`).join("")}</div>
                </div>
              </div>
              <div class="card-b">
                <div class="lat-row" id="ov-lat"></div>
                <div class="chart-box" id="ov-chart"></div>
                <div class="legend"><span><i class="dot acc"></i>查询量</span><span><i class="dot red"></i>错误 / 无响应</span></div>
              </div>
            </section>
            <section class="grid-3">
              <div class="card"><div class="card-h"><h2>热门域名</h2></div><div class="card-b" id="ov-topq"></div></div>
              <div class="card"><div class="card-h"><h2>活跃客户端</h2></div><div class="card-b" id="ov-topc"></div></div>
              <div class="card"><div class="card-h"><h2>响应分布</h2></div><div class="card-b" id="ov-dist"></div></div>
            </section>`
          : `<section class="card hint">${icon("layers")}<div><b>未发现 query_recorder 插件</b><p>在配置中加入 <code>query_recorder</code> 插件后，这里会显示查询趋势、延迟分位、热门域名与客户端。</p></div></section>`
      }`;

    root.addEventListener("click", (e) => {
      const b = (e.target as HTMLElement).closest("[data-r]") as HTMLElement | null;
      if (b) {
        range = b.dataset.r as RangeKey;
        root.querySelectorAll("#ov-range button").forEach((x) => x.classList.toggle("on", x === b));
        loadRecorder(root);
      }
      const q = (e.target as HTMLElement).closest("[data-qname]") as HTMLElement | null;
      if (q) location.hash = `#/queries?qname=${encodeURIComponent(q.dataset.qname!)}`;
      const c = (e.target as HTMLElement).closest("[data-client]") as HTMLElement | null;
      if (c) location.hash = `#/queries?client=${encodeURIComponent(c.dataset.client!)}`;
    });
    root.querySelector("#ov-recsel")?.addEventListener("change", (e) => {
      recorderTag = (e.target as HTMLSelectElement).value;
      loadRecorder(root);
    });

    const tick = () => loadLive(root);
    tick();
    loadRecorder(root);
    const t1 = setInterval(tick, 5000);
    const t2 = setInterval(() => loadRecorder(root, true), 30000);
    const onResize = () => lastChart && drawChart(root);
    window.addEventListener("resize", onResize);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
      window.removeEventListener("resize", onResize);
    };
  },
};

function skeletonStats() {
  return Array.from({ length: 4 }, () => `<div class="stat"><div class="skel" style="height:64px"></div></div>`).join("");
}

async function loadLive(root: HTMLElement) {
  const [m, sys] = await Promise.all([loadMetrics(), get<SystemInfo>("/system").catch(() => null)]);
  if (!root.isConnected) return;
  renderStats(root, m);
  renderUpstreams(root, m);
  renderSys(root, sys);
}

function renderStats(root: HTMLElement, m: Sample[] | null) {
  const el = root.querySelector("#ov-stats")!;
  if (!m) {
    el.innerHTML = `<div class="card hint wide">${icon("alert")}<div><b>无法读取 /metrics</b><p>当前构建可能未启用 <code>metrics</code> 特性。</p></div></div>`;
    return;
  }
  const reqTotal = sum(m, "server_request_total");
  const failed = (sum(m, "server_failed_total") ?? 0);
  const latSum = sum(m, "server_latency_sum_ms"), latCnt = sum(m, "server_latency_count");
  const hit = sum(m, "cache_hit_total"), lookup = sum(m, "cache_lookup_total");
  const entries = sum(m, "cache_entry_count");

  const now = Date.now();
  if (reqTotal != null) {
    if (lastReq && now > lastReq.t && reqTotal >= lastReq.v) {
      qpsHistory.push(((reqTotal - lastReq.v) * 1000) / (now - lastReq.t));
      if (qpsHistory.length > 60) qpsHistory.shift();
    }
    lastReq = { t: now, v: reqTotal };
  }
  const qps = qpsHistory.at(-1);

  el.innerHTML = [
    stat("实时 QPS", qps == null ? "…" : qps < 10 ? qps.toFixed(1) : num(qps), qpsHistory.length > 1 ? sparkline(qpsHistory, 140, 34) : `<span class="sub">采样中…</span>`, "zap"),
    stat("累计请求", compact(reqTotal), `<span class="sub">失败 ${num(failed)}${reqTotal ? ` · ${pct(failed / reqTotal, 2)}` : ""}</span>`, "server"),
    stat("平均处理耗时", latSum != null && latCnt ? ms(latSum / latCnt) : "—", `<span class="sub">服务端整体</span>`, "clock"),
    stat("缓存命中率", lookup ? pct((hit ?? 0) / lookup) : "—", `<span class="sub">${entries != null ? `${num(entries)} 条缓存` : "未启用缓存"}</span>`, "db", lookup ? (hit ?? 0) / lookup : null),
  ].join("");
}

function stat(label: string, value: string, foot: string, ic: string, ring: number | null = null) {
  return `<div class="stat"><div class="stat-top"><span class="stat-label">${icon(ic)}${esc(label)}</span>${ring != null ? `<span class="ring" style="--p:${(ring * 100).toFixed(1)}"></span>` : ""}</div><div class="stat-val">${value}</div><div class="stat-foot">${foot}</div></div>`;
}

function renderUpstreams(root: HTMLElement, m: Sample[] | null) {
  const el = root.querySelector("#ov-upstreams .card-b")!;
  if (!m) return void (el.innerHTML = `<div class="empty sm">无指标数据</div>`);
  const ups = new Map<string, { tag: string; up: string; q: number; ok: number; err: number; to: number; ls: number; lc: number }>();
  for (const s of m) {
    if (!s.name.startsWith("forward_upstream_")) continue;
    const key = `${s.labels.plugin_tag}\u0000${s.labels.upstream}`;
    const u = ups.get(key) ?? { tag: s.labels.plugin_tag ?? "", up: s.labels.upstream ?? "?", q: 0, ok: 0, err: 0, to: 0, ls: 0, lc: 0 };
    const k = s.name.slice("forward_upstream_".length);
    if (k === "query_total") u.q += s.value;
    else if (k === "success_total") u.ok += s.value;
    else if (k === "error_total") u.err += s.value;
    else if (k === "timeout_total") u.to += s.value;
    else if (k === "latency_sum_ms") u.ls += s.value;
    else if (k === "latency_count") u.lc += s.value;
    ups.set(key, u);
  }
  const rows = [...ups.values()].sort((a, b) => b.q - a.q);
  if (!rows.length) return void (el.innerHTML = `<div class="empty sm">没有 forward 上游指标</div>`);
  const multiTag = new Set(rows.map((r) => r.tag)).size > 1;
  el.innerHTML = `<table class="tbl compact"><thead><tr><th style="width:38%">上游</th><th class="r">查询</th><th class="r">成功率</th><th class="r">平均延迟</th><th class="r">超时</th></tr></thead><tbody>${rows
    .map((u) => {
      const rate = u.q ? u.ok / u.q : null;
      const cls = rate == null ? "" : rate > 0.98 ? "green" : rate > 0.9 ? "amber" : "red";
      return `<tr><td><div class="mono trunc" title="${esc(u.up)}">${esc(u.up)}</div>${multiTag ? `<div class="sub">${esc(u.tag)}</div>` : ""}</td><td class="r num">${compact(u.q)}</td><td class="r"><span class="txt-${cls}">${pct(rate)}</span></td><td class="r num">${u.lc ? ms(u.ls / u.lc) : "—"}</td><td class="r num">${num(u.to)}</td></tr>`;
    })
    .join("")}</tbody></table>`;
}

function renderSys(root: HTMLElement, s: SystemInfo | null) {
  const el = root.querySelector("#ov-sys .card-b")!;
  if (!s) return void (el.innerHTML = `<div class="empty sm">无法读取 /system</div>`);
  const mem = s.process_memory_mb, total = s.system_memory_total_mb;
  const rl = s.reload;
  el.innerHTML = `<dl class="kv">
    <dt>版本</dt><dd><span class="mono">${esc(s.version)}</span>${state.build?.bundle ? ` <span class="badge muted">${esc(state.build.bundle)}</span>` : ""}</dd>
    <dt>平台</dt><dd>${esc(s.os)} / ${esc(s.arch)}</dd>
    <dt>运行时长</dt><dd>${dur(s.uptime_ms)}</dd>
    <dt>CPU</dt><dd>${s.process_cpu_percent != null ? `${meter(s.process_cpu_percent / 100)}${s.process_cpu_percent.toFixed(1)}%` : "—"}</dd>
    <dt>内存</dt><dd>${mem != null ? `${total ? meter(mem / total) : ""}${mem.toFixed(1)} MB${total ? `<span class="sub"> / ${(total / 1024).toFixed(1)} GB</span>` : ""}` : "—"}</dd>
    <dt>插件</dt><dd>${state.plugins.length} 个</dd>
    <dt>配置重载</dt><dd>${rl?.in_progress ? `<span class="badge amber">重载中</span>` : rl?.last_error ? `<span class="badge red" title="${esc(rl.last_error)}">上次失败</span>` : `<span class="badge green">正常</span>`}</dd>
  </dl>`;
}

const meter = (r: number) => `<span class="meter"><i style="width:${Math.min(100, Math.max(0, r * 100)).toFixed(1)}%"></i></span>`;

// ---------- query recorder ----------
let lastChart: { pts: SeriesPoint[]; bucketMs: number } | null = null;

async function loadRecorder(root: HTMLElement, quiet = false) {
  if (!recorderTag) return;
  const r = RANGES[range];
  const f = { since_ms: Date.now() - r.span };
  const tag = recorderTag;
  if (!quiet) {
    root.querySelector("#ov-chart")!.innerHTML = `<div class="skel" style="height:100%"></div>`;
  }
  const [ts, lat, tq, tc, rc, qt] = await Promise.all([
    get(plugin(tag, "/stats/timeseries"), { ...f, bucket: r.bucket, buckets: r.buckets }).catch(() => null),
    get(plugin(tag, "/stats/latency"), { ...f, slow_limit: 5 }).catch(() => null),
    get(plugin(tag, "/stats/top_qnames"), { ...f, limit: 8 }).catch(() => null),
    get(plugin(tag, "/stats/top_clients"), { ...f, limit: 8 }).catch(() => null),
    get(plugin(tag, "/stats/rcode"), f).catch(() => null),
    get(plugin(tag, "/stats/qtype"), f).catch(() => null),
  ]);
  if (!root.isConnected || tag !== recorderTag) return;

  const latEl = root.querySelector("#ov-lat")!;
  latEl.innerHTML = lat
    ? [["样本", num(lat.sample_size)], ["平均", ms(lat.avg_ms)], ["P50", ms(lat.p50_ms)], ["P95", ms(lat.p95_ms)], ["P99", ms(lat.p99_ms)], ["最大", ms(lat.max_ms)]]
        .map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`)
        .join("")
    : "";

  if (ts?.points) {
    const bucketMs = ts.bucket_ms || (r.bucket === "minute" ? 60000 : 3600000);
    // Fill gaps so the x-axis stays continuous.
    const map = new Map<number, any>(ts.points.map((p: any) => [p.bucket_ms, p]));
    const end = Math.floor(Date.now() / bucketMs) * bucketMs;
    const pts: SeriesPoint[] = [];
    for (let i = r.buckets - 1; i >= 0; i--) {
      const t = end - i * bucketMs;
      const p = map.get(t);
      pts.push({ t, v: p?.total ?? 0, v2: (p?.error_count ?? 0) + (p?.no_response_count ?? 0), label: p ? `${ms(p.avg_ms)} / P95 ${ms(p.p95_ms)}` : "" });
    }
    lastChart = { pts, bucketMs };
    drawChart(root);
  } else root.querySelector("#ov-chart")!.innerHTML = `<div class="empty sm">暂无时间序列</div>`;

  root.querySelector("#ov-topq")!.innerHTML = rankList(tq?.rows ?? [], { mono: true, onClickAttr: "data-qname" });
  root.querySelector("#ov-topc")!.innerHTML = rankList(tc?.rows ?? [], { mono: true, onClickAttr: "data-client" });
  root.querySelector("#ov-dist")!.innerHTML = `<div class="sub-h">RCODE</div>${chips(rc?.rows ?? [])}<div class="sub-h">记录类型</div>${chips(qt?.rows ?? [])}`;
}

function chips(rows: { key: string; count: number; share: number }[]) {
  if (!rows.length) return `<div class="empty sm">暂无数据</div>`;
  const total = rows.reduce((a, r) => a + r.count, 0) || 1;
  const palette = ["c1", "c2", "c3", "c4", "c5", "c6"];
  return `<div class="stackbar">${rows.slice(0, 6).map((r, i) => `<i class="${palette[i]}" style="flex:${r.count / total}" title="${esc(r.key)} ${pct(r.share)}"></i>`).join("")}</div>
  <ul class="chips">${rows.slice(0, 8).map((r, i) => `<li><i class="dot ${palette[i] ?? "c6"}"></i><span class="mono">${esc(r.key)}</span><b>${pct(r.share)}</b></li>`).join("")}</ul>`;
}

function drawChart(root: HTMLElement) {
  const el = root.querySelector("#ov-chart") as HTMLElement | null;
  if (!el || !lastChart) return;
  const hourly = lastChart.bucketMs >= 3600000;
  const fmt = (t: number) => {
    const d = new Date(t);
    const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    return hourly && range === "7d" ? `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}h` : hm;
  };
  barChart(el, lastChart.pts, {
    fmtT: fmt,
    tip: (p) => `<span>${esc(fmt(p.t))}</span><b>${num(p.v)} 次</b>${p.v2 ? `<span class="txt-red">异常 ${num(p.v2)}</span>` : ""}${p.label ? `<span class="sub">${esc(p.label)}</span>` : ""}`,
  });
}

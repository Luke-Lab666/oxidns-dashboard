// Small DOM/format helpers, icons, toasts, modal, drawer, and SVG charts.

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T | null;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) =>
  Array.from(root.querySelectorAll(sel)) as T[];

export function esc(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

// ---------- formatting ----------
const nf = new Intl.NumberFormat("zh-CN");
export const num = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "—" : nf.format(Math.round(n)));
export function compact(n: number | null | undefined) {
  if (n == null || !Number.isFinite(n)) return "—";
  const a = Math.abs(n);
  if (a >= 1e8) return (n / 1e8).toFixed(a >= 1e9 ? 0 : 1) + " 亿";
  if (a >= 1e4) return (n / 1e4).toFixed(a >= 1e5 ? 0 : 1) + " 万";
  return nf.format(Math.round(n * 10) / 10);
}
export const pct = (r: number | null | undefined, d = 1) => (r == null || !Number.isFinite(r) ? "—" : (r * 100).toFixed(d) + "%");
export function ms(v: number | null | undefined) {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v < 1) return v.toFixed(2) + " ms";
  if (v < 100) return v.toFixed(1) + " ms";
  if (v < 10000) return Math.round(v) + " ms";
  return (v / 1000).toFixed(1) + " s";
}
export function dur(msv: number) {
  const s = Math.floor(msv / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d) return `${d} 天 ${h} 小时`;
  if (h) return `${h} 小时 ${m} 分`;
  if (m) return `${m} 分 ${s % 60} 秒`;
  return `${s} 秒`;
}
const pad = (n: number) => String(n).padStart(2, "0");
export function time(t: number | string | undefined, withDate = false) {
  if (t == null) return "—";
  const d = new Date(t);
  if (isNaN(+d)) return String(t);
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  if (!withDate && Date.now() - +d < 86400_000) return hms;
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hms}`;
}
export function ago(t?: number) {
  if (!t) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s} 秒前`;
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`;
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`;
  return `${Math.floor(s / 86400)} 天前`;
}

// ---------- icons (lucide-style, inline) ----------
const P: Record<string, string> = {
  gauge: '<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
  list: '<path d="M3 12h.01M3 18h.01M3 6h.01M8 12h13M8 18h13M8 6h13"/>',
  db: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
  puzzle: '<path d="M15.39 4.39a1 1 0 0 0 1.68-.474 2.5 2.5 0 1 1 3.014 3.015 1 1 0 0 0-.474 1.68l1.683 1.682a2.414 2.414 0 0 1 0 3.414L19.61 15.39a1 1 0 0 1-1.68-.474 2.5 2.5 0 1 0-3.014 3.015 1 1 0 0 1 .474 1.68l-1.683 1.682a2.414 2.414 0 0 1-3.414 0L8.61 19.61a1 1 0 0 0-1.68.474 2.5 2.5 0 1 1-3.014-3.015 1 1 0 0 0 .474-1.68l-1.683-1.682a2.414 2.414 0 0 1 0-3.414L4.39 8.61a1 1 0 0 1 1.68.474 2.5 2.5 0 1 0 3.014-3.015 1 1 0 0 1-.474-1.68l1.683-1.682a2.414 2.414 0 0 1 3.414 0z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="m10 13-2 2 2 2M14 17l2-2-2-2"/>',
  terminal: '<path d="m4 17 6-6-6-6M12 19h8"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/><path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"/><path d="M8 16H3v5"/>',
  power: '<path d="M12 2v10"/><path d="M18.4 6.6a9 9 0 1 1-12.77.04"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2m-7.07-14.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  trash: '<path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  play: '<path d="M6 3l14 9-14 9V3z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  save: '<path d="M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7M7 3v4a1 1 0 0 0 1 1h7"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  menu: '<path d="M4 12h16M4 6h16M4 18h16"/>',
  zap: '<path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/>',
  clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4M12 17h.01"/>',
  server: '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
  cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  arrowDown: '<path d="M12 5v14M19 12l-7 7-7-7"/>',
};
export const icon = (name: string, cls = "") =>
  `<svg class="ic ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ""}</svg>`;

// ---------- toasts ----------
export function toast(msg: string, kind: "ok" | "err" | "info" = "info", timeout = 3800) {
  let box = $("#toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    document.body.appendChild(box);
  }
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  el.innerHTML = `${icon(kind === "ok" ? "check" : kind === "err" ? "alert" : "zap")}<span>${esc(msg)}</span>`;
  box.appendChild(el);
  requestAnimationFrame(() => el.classList.add("in"));
  setTimeout(() => {
    el.classList.remove("in");
    setTimeout(() => el.remove(), 250);
  }, timeout);
}
export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- modal confirm ----------
export function confirmDialog(opts: { title: string; body?: string; ok?: string; danger?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    const wrap = document.createElement("div");
    wrap.className = "modal-wrap";
    wrap.innerHTML = `<div class="modal" role="dialog" aria-modal="true">
      <h3>${esc(opts.title)}</h3>
      ${opts.body ? `<p>${opts.body}</p>` : ""}
      <div class="modal-actions">
        <button class="btn ghost" data-v="0">取消</button>
        <button class="btn ${opts.danger ? "danger" : "primary"}" data-v="1">${esc(opts.ok ?? "确定")}</button>
      </div></div>`;
    const done = (v: boolean) => {
      wrap.classList.remove("in");
      document.removeEventListener("keydown", onKey);
      setTimeout(() => wrap.remove(), 180);
      resolve(v);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") done(false);
      if (e.key === "Enter") done(true);
    };
    wrap.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      if (t === wrap) return done(false);
      const b = t.closest("[data-v]") as HTMLElement | null;
      if (b) done(b.dataset.v === "1");
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add("in"));
    (wrap.querySelector('[data-v="1"]') as HTMLElement).focus();
  });
}

// ---------- side drawer ----------
export function drawer(title: string, bodyHtml: string, onMount?: (root: HTMLElement) => void) {
  $(".drawer-wrap")?.remove();
  const wrap = document.createElement("div");
  wrap.className = "drawer-wrap";
  wrap.innerHTML = `<aside class="drawer"><header><h3>${title}</h3><button class="icon-btn" data-close title="关闭">${icon("x")}</button></header><div class="drawer-body">${bodyHtml}</div></aside>`;
  const close = () => {
    wrap.classList.remove("in");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => wrap.remove(), 220);
  };
  const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
  wrap.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === wrap || t.closest("[data-close]")) close();
  });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("in"));
  onMount?.(wrap.querySelector(".drawer-body") as HTMLElement);
  return { root: wrap.querySelector(".drawer-body") as HTMLElement, close };
}

// ---------- charts ----------
export interface SeriesPoint {
  t: number;
  v: number;
  v2?: number; // stacked error portion
  label?: string;
}

/** Bar chart with optional stacked "error" portion and hover tooltip. */
export function barChart(el: HTMLElement, pts: SeriesPoint[], opts: { fmtT: (t: number) => string; fmtV?: (v: number) => string; tip?: (p: SeriesPoint) => string }) {
  const W = el.clientWidth || 600;
  const H = el.clientHeight || 180;
  const pl = 36, pb = 20, pt = 8, pr = 4;
  const iw = W - pl - pr, ih = H - pt - pb;
  const max = Math.max(1, ...pts.map((p) => p.v));
  const nice = niceMax(max);
  const bw = pts.length ? iw / pts.length : iw;
  const gap = Math.min(3, bw * 0.25);
  const fmtV = opts.fmtV ?? compact;
  let g = "";
  for (let i = 0; i <= 4; i++) {
    const y = pt + ih - (ih * i) / 4;
    g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" class="grid"/><text x="${pl - 6}" y="${y + 3}" class="axis" text-anchor="end">${esc(fmtV((nice * i) / 4))}</text>`;
  }
  let bars = "";
  pts.forEach((p, i) => {
    const h = (p.v / nice) * ih;
    const x = pl + i * bw + gap / 2;
    const w = Math.max(1, bw - gap);
    const y = pt + ih - h;
    bars += `<rect x="${x}" y="${y}" width="${w}" height="${Math.max(h, p.v ? 1 : 0)}" rx="${Math.min(2, w / 2)}" class="bar"/>`;
    if (p.v2) {
      const h2 = (p.v2 / nice) * ih;
      bars += `<rect x="${x}" y="${pt + ih - h2}" width="${w}" height="${h2}" rx="${Math.min(2, w / 2)}" class="bar err"/>`;
    }
    bars += `<rect x="${pl + i * bw}" y="${pt}" width="${bw}" height="${ih}" class="hit" data-i="${i}"/>`;
  });
  let ticks = "";
  const step = Math.max(1, Math.ceil(pts.length / Math.max(2, Math.floor(iw / 70))));
  for (let i = 0; i < pts.length; i += step) {
    ticks += `<text x="${pl + i * bw + bw / 2}" y="${H - 4}" class="axis" text-anchor="middle">${esc(opts.fmtT(pts[i].t))}</text>`;
  }
  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" class="chart">${g}${bars}${ticks}</svg><div class="chart-tip"></div>`;
  const tip = el.querySelector(".chart-tip") as HTMLElement;
  el.querySelector("svg")!.addEventListener("mousemove", (e) => {
    const t = (e.target as Element).closest(".hit") as SVGElement | null;
    if (!t) return void (tip.style.opacity = "0");
    const p = pts[Number(t.dataset.i)];
    tip.innerHTML = opts.tip ? opts.tip(p) : `${esc(opts.fmtT(p.t))}<b>${esc(fmtV(p.v))}</b>`;
    const r = el.getBoundingClientRect();
    tip.style.opacity = "1";
    const x = (e as MouseEvent).clientX - r.left;
    tip.style.left = Math.min(Math.max(x, 70), r.width - 70) + "px";
    tip.style.top = "0px";
  });
  el.querySelector("svg")!.addEventListener("mouseleave", () => (tip.style.opacity = "0"));
}

/** Tiny line sparkline. */
export function sparkline(values: number[], w = 120, h = 32) {
  if (values.length < 2) return `<svg width="${w}" height="${h}" class="spark"></svg>`;
  const max = Math.max(...values, 1e-9), min = Math.min(...values, 0);
  const sx = w / (values.length - 1);
  const pts = values.map((v, i) => `${(i * sx).toFixed(1)},${(h - 2 - ((v - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`);
  return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" class="spark"><polyline points="0,${h} ${pts.join(" ")} ${w},${h}" class="area"/><polyline points="${pts.join(" ")}" class="line"/></svg>`;
}

/** Round the axis max up so that 4 gridlines land on whole, readable steps. */
function niceMax(v: number) {
  const raw = Math.max(v / 4, 1);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= raw) return Math.max(4, Math.ceil(m * p) * 4);
  return 40 * p;
}

/** Horizontal ranked bar list. */
export function rankList(rows: { key: string; count: number; share?: number }[], opts: { empty?: string; mono?: boolean; onClickAttr?: string } = {}) {
  if (!rows.length) return `<div class="empty sm">${esc(opts.empty ?? "暂无数据")}</div>`;
  const max = Math.max(...rows.map((r) => r.count), 1);
  return `<ol class="rank">${rows
    .map(
      (r) => `<li ${opts.onClickAttr ? `${opts.onClickAttr}="${esc(r.key)}" class="clickable"` : ""}>
      <div class="rank-bar" style="width:${((r.count / max) * 100).toFixed(1)}%"></div>
      <span class="rank-key ${opts.mono ? "mono" : ""}" title="${esc(r.key)}">${esc(r.key || "(空)")}</span>
      <span class="rank-val">${num(r.count)}${r.share != null ? `<em>${pct(r.share)}</em>` : ""}</span></li>`,
    )
    .join("")}</ol>`;
}

export function rcodeBadge(rcode?: string, error?: string, hasResp = true) {
  if (error) return `<span class="badge red" title="${esc(error)}">ERROR</span>`;
  if (!hasResp) return `<span class="badge amber">无响应</span>`;
  const r = (rcode ?? "").toUpperCase();
  const cls = r === "NOERROR" ? "green" : r === "NXDOMAIN" ? "amber" : r ? "red" : "muted";
  return `<span class="badge ${cls}">${esc(r || "—")}</span>`;
}

export function debounce<T extends (...a: any[]) => void>(fn: T, wait = 300) {
  let t: number | undefined;
  return (...a: Parameters<T>) => {
    clearTimeout(t);
    t = window.setTimeout(() => fn(...a), wait);
  };
}

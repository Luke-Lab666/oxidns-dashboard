import * as yaml from "js-yaml";
import { ApiError, del, get, plugin, post } from "../api";
import { byTag, loadMetrics, state, type PluginInfo, type PluginType, type Sample } from "../state";
import { $, compact, confirmDialog, drawer, errMsg, esc, icon, ms, num, time, toast } from "../ui";
import type { Page } from "./page";

const TYPE_LABEL: Record<PluginType, string> = { server: "服务", executor: "执行器", matcher: "匹配器", provider: "数据源", unknown: "其他" };
const TYPE_ORDER: PluginType[] = ["server", "executor", "matcher", "provider", "unknown"];
type Mode = "normal" | "always_true" | "always_false";

let filterType: PluginType | "all" = "all";

export const plugins: Page = {
  title: "插件",
  mount(root) {
    let metrics: Sample[] = [];
    const modes = new Map<string, Mode | null>();
    let q = "";

    root.innerHTML = `
      <div class="toolbar card">
        <div class="field grow">${icon("search")}<input id="p-q" placeholder="搜索 tag 或类型…"></div>
        <div class="seg" id="p-type"><button data-t="all" class="on">全部 <em>${state.plugins.length}</em></button>${TYPE_ORDER.filter((t) => state.plugins.some((p) => p.type === t))
          .map((t) => `<button data-t="${t}">${TYPE_LABEL[t]} <em>${state.plugins.filter((p) => p.type === t).length}</em></button>`)
          .join("")}</div>
      </div>
      <div id="p-list"></div>`;
    root.querySelectorAll<HTMLElement>("#p-type button").forEach((b) => b.classList.toggle("on", b.dataset.t === filterType));

    const list = $("#p-list", root)!;

    function render() {
      const items = state.plugins.filter((p) => (filterType === "all" || p.type === filterType) && (!q || `${p.tag} ${p.kind}`.toLowerCase().includes(q)));
      if (!items.length) {
        list.innerHTML = `<div class="empty">${icon("puzzle")}${state.configError ? `配置解析失败：${esc(state.configError)}` : "没有匹配的插件"}</div>`;
        return;
      }
      list.innerHTML = TYPE_ORDER.map((t) => {
        const group = items.filter((p) => p.type === t);
        if (!group.length) return "";
        return `<h3 class="group-h">${TYPE_LABEL[t]}<span>${group.length}</span></h3><div class="pgrid">${group.map(card).join("")}</div>`;
      }).join("");
    }

    function card(p: PluginInfo) {
      const s = byTag(metrics, p.tag);
      const m = keyMetrics(p, s);
      const mode = modes.get(p.tag);
      return `<article class="pcard t-${p.type}" data-tag="${esc(p.tag)}">
        <header><div><div class="ptag mono">${esc(p.tag)}</div><div class="pkind">${esc(p.kind)}</div></div><span class="badge t-${p.type}">${TYPE_LABEL[p.type]}</span></header>
        ${m.length ? `<div class="pmetrics">${m.map(([k, v]) => `<div><span>${esc(k)}</span><b>${v}</b></div>`).join("")}</div>` : `<div class="pdesc sub">${esc(describe(p))}</div>`}
        <footer>
          ${
            p.type === "matcher" && mode !== undefined && mode !== null
              ? `<div class="seg xs mode" data-mode-for="${esc(p.tag)}">${(["normal", "always_true", "always_false"] as Mode[])
                  .map((x) => `<button data-mode="${x}" class="${mode === x ? "on" : ""} m-${x}" title="${modeTitle(x)}">${modeLabel(x)}</button>`)
                  .join("")}</div>`
              : ""
          }
          ${p.type === "provider" ? `<button class="btn ghost xs" data-act="reload-provider">${icon("refresh")}重载</button>` : ""}
          ${p.kind === "cron" || p.kind === "download" || p.kind === "dynamic_domain_set" ? `<button class="btn ghost xs" data-act="open">${icon("chevron")}${p.kind === "cron" ? "任务" : p.kind === "download" ? "下载" : "规则"}</button>` : ""}
          ${p.kind === "cache" ? `<a class="btn ghost xs" href="#/cache">${icon("db")}管理</a>` : ""}
          ${p.kind === "query_recorder" ? `<a class="btn ghost xs" href="#/queries">${icon("list")}日志</a>` : ""}
          <span class="spacer"></span>
        </footer>
      </article>`;
    }

    root.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).id === "p-q") {
        q = (e.target as HTMLInputElement).value.trim().toLowerCase();
        render();
      }
    });
    root.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      const tb = t.closest("[data-t]") as HTMLElement | null;
      if (tb) {
        filterType = tb.dataset.t as any;
        root.querySelectorAll("#p-type button").forEach((b) => b.classList.toggle("on", b === tb));
        return render();
      }
      if (t.closest("a")) return;
      const cardEl = t.closest(".pcard") as HTMLElement | null;
      if (!cardEl) return;
      const p = state.plugins.find((x) => x.tag === cardEl.dataset.tag)!;
      const mb = t.closest("[data-mode]") as HTMLElement | null;
      if (mb) return setMode(p.tag, mb.dataset.mode as Mode);
      const act = t.closest("[data-act]") as HTMLElement | null;
      if (act?.dataset.act === "reload-provider") {
        act.classList.add("loading");
        try {
          await post(plugin(p.tag, "/reload"));
          toast(`${p.tag} 已重载`, "ok");
        } catch (err) {
          toast(err instanceof ApiError && err.status === 404 ? "该数据源不支持运行时重载" : errMsg(err), "err");
        } finally {
          act.classList.remove("loading");
        }
        return;
      }
      openDetail(p, byTag(metrics, p.tag));
    });

    async function setMode(tag: string, mode: Mode) {
      if (modes.get(tag) === mode) return;
      if (mode !== "normal") {
        const ok = await confirmDialog({
          title: `将 ${tag} 固定为${mode === "always_true" ? "「始终匹配」" : "「始终不匹配」"}？`,
          body: `正向引用 <code>$${esc(tag)}</code> 将恒为 ${mode === "always_true" ? "true" : "false"}，取反引用 <code>!$${esc(tag)}</code> 恒为 ${mode === "always_true" ? "false" : "true"}。该设置仅在运行时生效，重启或重载后恢复正常。`,
          ok: "确认切换",
          danger: mode === "always_true",
        });
        if (!ok) return;
      }
      try {
        const r = await post(plugin(tag, "/mode"), { mode });
        modes.set(tag, r.mode ?? mode);
        render();
        toast(`${tag} → ${modeLabel(r.mode ?? mode)}`, "ok");
      } catch (err) {
        toast(errMsg(err), "err");
      }
    }

    async function refresh() {
      const [m] = await Promise.all([
        loadMetrics(),
        ...state.plugins
          .filter((p) => p.type === "matcher" && !modes.has(p.tag))
          .map((p) =>
            get(plugin(p.tag, "/status"))
              .then((r) => modes.set(p.tag, r.mode))
              .catch(() => modes.set(p.tag, null)),
          ),
      ]);
      metrics = (m as Sample[] | null) ?? [];
      if (root.isConnected && !document.activeElement?.closest?.(".pcard")) render();
    }

    render();
    refresh();
    const timer = setInterval(refresh, 10000);
    return () => clearInterval(timer);
  },
};

const modeLabel = (m: Mode) => (m === "normal" ? "正常" : m === "always_true" ? "恒真" : "恒假");
const modeTitle = (m: Mode) => (m === "normal" ? "按规则正常匹配" : m === "always_true" ? "运行时强制始终匹配" : "运行时强制始终不匹配");

function describe(p: PluginInfo) {
  const a: any = p.args;
  if (p.type === "server" && a?.listen) return `监听 ${a.listen}${a.entry ? ` → ${a.entry}` : ""}`;
  if (p.kind === "sequence" && Array.isArray(a)) return `${a.length} 条规则`;
  if (p.kind === "forward" && Array.isArray(a?.upstreams)) return `${a.upstreams.length} 个上游`;
  if (Array.isArray(a?.files)) return `${a.files.length} 个文件`;
  if (Array.isArray(a)) return `${a.length} 项`;
  return a && typeof a === "object" ? `${Object.keys(a).length} 个参数` : "无参数";
}

function keyMetrics(p: PluginInfo, s: Sample[]): [string, string][] {
  if (!s.length) return [];
  const v = (n: string) => {
    let t: number | null = null;
    for (const x of s) if (x.name === n) t = (t ?? 0) + x.value;
    return t;
  };
  const avg = (prefix: string) => {
    const a = v(`${prefix}_latency_sum_ms`), c = v(`${prefix}_latency_count`);
    return a != null && c ? ms(a / c) : null;
  };
  const out: [string, string | null][] = [];
  switch (p.kind) {
    case "forward": {
      const qq = v("forward_query_total"), ok = v("forward_success_total");
      out.push(["查询", compact(qq)], ["成功率", qq ? ((100 * (ok ?? 0)) / qq).toFixed(1) + "%" : null], ["平均", avg("forward")]);
      break;
    }
    case "cache": {
      const h = v("cache_hit_total"), l = v("cache_lookup_total");
      out.push(["条目", compact(v("cache_entry_count"))], ["命中率", l ? ((100 * (h ?? 0)) / l).toFixed(1) + "%" : null], ["查找", compact(l)]);
      break;
    }
    default:
      if (p.type === "server") {
        out.push(["请求", compact(v("server_request_total"))], ["失败", compact(v("server_failed_total"))], ["平均", avg("server")]);
        break;
      }
      for (const x of aggregate(s).slice(0, 3)) out.push([prettyMetric(x[0], p.kind), compact(x[1])]);
  }
  return out.filter((x): x is [string, string] => x[1] != null && x[1] !== "—");
}

function aggregate(s: Sample[]) {
  const m = new Map<string, number>();
  for (const x of s) if (!x.name.endsWith("_sum_ms") && !x.name.endsWith("_timestamp_seconds")) m.set(x.name, (m.get(x.name) ?? 0) + x.value);
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const METRIC_ZH: Record<string, string> = {
  success: "成功", failure: "失败", timeout: "超时", "job run": "运行次数", "job skipped": "跳过", "executor error": "错误",
  hit: "命中", miss: "未命中", block: "拦截", query: "查询", error: "错误", dispatch: "派发", dropped: "丢弃",
  "write": "写入", "write error": "写入失败", selected: "选中", probe: "探测", primary: "主路", secondary: "备路", "primary error": "主路错误",
};
function prettyMetric(name: string, kind: string) {
  const k = name.replace(new RegExp(`^${kind}_`), "").replace(/^(cron|download|hosts|blackhole|fallback|ipset|nftset|http_request|ip_selector)_/, "").replace(/_total$/, "").replace(/_/g, " ");
  if (METRIC_ZH[k]) return METRIC_ZH[k];
  return name.replace(new RegExp(`^${kind}_`), "").replace(/_total$/, "").replace(/_/g, " ");
}

// ---------- detail drawer ----------
function openDetail(p: PluginInfo, s: Sample[]) {
  const argsYaml = p.args === undefined ? "" : yaml.dump(p.args, { lineWidth: 120, noRefs: true });
  const series = s.filter((x) => !x.name.endsWith("_timestamp_seconds"));
  const d = drawer(
    `<span class="mono">${esc(p.tag)}</span> <span class="badge t-${p.type}">${esc(p.kind)}</span>`,
    `<div id="pd-extra"></div>
     <h4>配置参数</h4>${argsYaml ? `<pre class="code">${esc(argsYaml)}</pre>` : `<div class="empty sm">无 args</div>`}
     ${
       series.length
         ? `<h4>指标 <span class="sub">${series.length}</span></h4><table class="tbl compact"><tbody>${series
             .map((x) => {
               const labels = Object.entries(x.labels).filter(([k]) => k !== "plugin_tag");
               return `<tr><td class="mono">${esc(x.name)}${labels.length ? `<div class="sub">${labels.map(([k, v]) => `${esc(k)}=${esc(v)}`).join(" ")}</div>` : ""}</td><td class="r num">${num(x.value)}</td></tr>`;
             })
             .join("")}</tbody></table>`
         : ""
     }`,
  );
  const extra = $("#pd-extra", d.root)!;
  if (p.kind === "cron") cronPanel(p.tag, extra);
  if (p.kind === "download") downloadPanel(p.tag, extra);
  if (p.kind === "dynamic_domain_set") rulesPanel(p.tag, extra);
}

async function cronPanel(tag: string, el: HTMLElement) {
  const draw = async () => {
    try {
      const r = await get(plugin(tag, "/jobs/status"));
      const jobs = Object.entries(r.jobs ?? {}) as [string, any][];
      el.innerHTML = `<h4>定时任务</h4>${
        jobs.length
          ? `<ul class="joblist">${jobs
              .map(([name, j]) => {
                const cur = j.current_run, last = j.last_manual_run;
                return `<li><div><div class="mono">${esc(name)}</div><div class="sub">${cur ? `运行中 · ${esc(cur.trigger)} · ${time(cur.started_at_ms)}` : last ? `上次手动：${esc(last.status)} · ${time(last.completed_at_ms)}` : "空闲"}</div></div>
                <button class="btn ghost xs" data-job="${esc(name)}" ${cur ? "disabled" : ""}>${icon("play")}立即运行</button></li>`;
              })
              .join("")}</ul>`
          : `<div class="empty sm">没有任务</div>`
      }`;
    } catch (e) {
      el.innerHTML = `<div class="empty sm">${esc(errMsg(e))}</div>`;
    }
  };
  el.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest("[data-job]") as HTMLButtonElement | null;
    if (!b) return;
    b.disabled = true;
    try {
      await post(plugin(tag, `/jobs/${encodeURIComponent(b.dataset.job!)}/run`));
      toast(`任务 ${b.dataset.job} 已启动`, "ok");
    } catch (err) {
      toast(errMsg(err), "err");
    }
    setTimeout(draw, 800);
  });
  draw();
}

async function downloadPanel(tag: string, el: HTMLElement) {
  const draw = async () => {
    try {
      const r = await get(plugin(tag, "/downloads"));
      el.innerHTML = `<div class="row between"><h4>下载项 ${r.running ? `<span class="badge amber">运行中</span>` : ""}</h4><button class="btn ghost xs" data-dl="all" ${r.running ? "disabled" : ""}>${icon("download")}全部下载</button></div>
      <ul class="joblist">${(r.downloads ?? [])
        .map((d: any) => `<li><div class="trunc"><div class="mono trunc" title="${esc(d.url)}">${esc(d.url)}</div><div class="sub mono">→ ${esc(d.path)}</div></div><button class="btn ghost xs" data-dl="${d.index}" ${r.running ? "disabled" : ""}>${icon("download")}</button></li>`)
        .join("")}</ul>`;
    } catch (e) {
      el.innerHTML = `<div class="empty sm">${esc(errMsg(e))}</div>`;
    }
  };
  el.addEventListener("click", async (e) => {
    const b = (e.target as HTMLElement).closest("[data-dl]") as HTMLButtonElement | null;
    if (!b) return;
    b.classList.add("loading");
    try {
      const r = await post(plugin(tag, "/download"), b.dataset.dl === "all" ? {} : { index: Number(b.dataset.dl) });
      toast(`下载完成：成功 ${r.succeeded} / 失败 ${r.failed}`, r.failed ? "err" : "ok");
    } catch (err) {
      toast(err instanceof ApiError && err.status === 409 ? "已有下载在进行中" : errMsg(err), "err");
    }
    draw();
  });
  draw();
}

async function rulesPanel(tag: string, el: HTMLElement) {
  let rules: string[] = [];
  let next: number | null = null;
  let total = 0;
  el.innerHTML = `<h4>动态域名规则</h4>
    <div class="rule-add"><textarea id="r-in" rows="3" placeholder="每行一个域名，如 example.com"></textarea>
    <div class="row gap"><select id="r-kind" class="sm"><option value="domain">domain（含子域）</option><option value="full">full（完全匹配）</option></select><span class="spacer"></span><button class="btn primary xs" id="r-add">${icon("plus")}添加</button></div></div>
    <div class="row between"><span class="sub" id="r-total"></span><button class="btn danger-o xs" id="r-clear">${icon("trash")}清空</button></div>
    <ul class="rules" id="r-list"></ul><div id="r-more"></div>`;
  const load = async (append = false) => {
    try {
      const r = await get(plugin(tag, "/rules"), { cursor: append ? next ?? undefined : undefined, limit: 200 });
      rules = append ? rules.concat(r.rules) : r.rules;
      next = r.next_cursor;
      total = r.total;
      $("#r-total", el)!.textContent = `共 ${total} 条`;
      $("#r-list", el)!.innerHTML = rules.map((x) => `<li><span class="mono">${esc(x)}</span><button class="icon-btn xs danger-h" data-rm="${esc(x)}">${icon("x")}</button></li>`).join("") || `<li class="empty sm">暂无规则</li>`;
      $("#r-more", el)!.innerHTML = next != null ? `<button class="btn ghost xs" id="r-next">加载更多</button>` : "";
    } catch (e) {
      $("#r-list", el)!.innerHTML = `<li class="empty sm">${esc(errMsg(e))}</li>`;
    }
  };
  el.addEventListener("click", async (e) => {
    const t = e.target as HTMLElement;
    try {
      if (t.closest("#r-add")) {
        const lines = ($("#r-in", el) as HTMLTextAreaElement).value.split(/[\n,\s]+/).map((s) => s.trim()).filter(Boolean);
        if (!lines.length) return;
        const r = await post(plugin(tag, "/rules"), { rules: lines, rule_kind: ($("#r-kind", el) as HTMLSelectElement).value });
        ($("#r-in", el) as HTMLTextAreaElement).value = "";
        toast(`新增 ${r.added} 条`, "ok");
        load();
      } else if (t.closest("[data-rm]")) {
        const rule = (t.closest("[data-rm]") as HTMLElement).dataset.rm!;
        await del(plugin(tag, "/rules"), { rules: [rule] });
        load();
      } else if (t.closest("#r-clear")) {
        if (!(await confirmDialog({ title: "清空全部动态规则？", ok: "清空", danger: true }))) return;
        await post(plugin(tag, "/rules/clear"));
        toast("已清空", "ok");
        load();
      } else if (t.closest("#r-next")) load(true);
    } catch (err) {
      toast(errMsg(err), "err");
    }
  });
  load();
}

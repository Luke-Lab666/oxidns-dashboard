import { del, get, plugin, type CacheEntry } from "../api";
import { byTag, loadMetrics, pluginsOfKind, sum } from "../state";
import { $, confirmDialog, debounce, drawer, errMsg, esc, icon, num, pct, time, toast } from "../ui";
import type { Page } from "./page";

export const cache: Page = {
  title: "缓存",
  mount(root) {
    const caches = pluginsOfKind("cache");
    if (!caches.length) {
      root.innerHTML = `<div class="card hint">${icon("db")}<div><b>未发现 cache 插件</b><p>配置中添加 <code>cache</code> 插件后，可在这里搜索、查看和清理缓存条目。</p></div></div>`;
      return;
    }
    let tag = caches[0].tag;
    let entries: CacheEntry[] = [];
    let cursor: string | undefined;
    let total = 0;

    root.innerHTML = `
      ${caches.length > 1 ? `<div class="tabs" id="c-tabs">${caches.map((c, i) => `<button data-tag="${esc(c.tag)}" class="${i === 0 ? "on" : ""}">${esc(c.tag)}</button>`).join("")}</div>` : ""}
      <section class="stats" id="c-stats"></section>
      <div class="toolbar card">
        <div class="field grow">${icon("search")}<input id="c-q" placeholder="按域名搜索缓存…"></div>
        <div class="spacer"></div>
        <button class="icon-btn" id="c-refresh" title="刷新">${icon("refresh")}</button>
        <button class="btn danger-o" id="c-flush">${icon("trash")}<span>清空缓存</span></button>
      </div>
      <div class="card flush">
        <table class="tbl hover" id="c-tbl"><thead><tr><th>域名</th><th style="width:80px">类型</th><th style="width:100px">RCODE</th><th class="r" style="width:70px">应答</th><th style="width:170px">剩余 TTL</th><th class="hide-sm" style="width:110px">最近访问</th><th style="width:44px"></th></tr></thead><tbody></tbody></table>
        <div class="tbl-foot" id="c-foot"></div>
      </div>`;

    const tbody = $("#c-tbl tbody", root)!;

    async function stats() {
      const m = await loadMetrics();
      const el = $("#c-stats", root);
      if (!el || !m) return;
      const s = byTag(m, tag);
      const hit = sum(s, "cache_hit_total") ?? 0, lookup = sum(s, "cache_lookup_total") ?? 0;
      el.innerHTML = [
        ["条目数", num(sum(s, "cache_entry_count"))],
        ["命中率", lookup ? pct(hit / lookup) : "—"],
        ["命中 / 查找", `${num(hit)} <span class="sub">/ ${num(lookup)}</span>`],
        ["写入", num(sum(s, "cache_insert_total"))],
        ["过期", num(sum(s, "cache_expired_total"))],
        ["懒刷新", num(sum(s, "cache_lazy_refresh_total"))],
      ]
        .map(([k, v]) => `<div class="stat mini"><div class="stat-label">${k}</div><div class="stat-val">${v}</div></div>`)
        .join("");
    }

    async function load(append = false) {
      if (!append) {
        cursor = undefined;
        tbody.innerHTML = `<tr><td colspan="7"><div class="skel" style="height:120px"></div></td></tr>`;
      }
      try {
        const qname = ($("#c-q", root) as HTMLInputElement).value.trim();
        const r = await get<{ entries: CacheEntry[]; next_cursor?: string; total_entries: number }>(plugin(tag, "/entries"), { limit: 100, cursor, qname });
        entries = append ? entries.concat(r.entries) : r.entries;
        cursor = r.next_cursor;
        total = r.total_entries;
        render();
      } catch (e) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty">${icon("alert")}${esc(errMsg(e))}</div></td></tr>`;
      }
    }

    function render() {
      tbody.innerHTML = entries.length
        ? entries
            .map((e) => {
              const ratio = e.ttl ? Math.min(1, e.remaining_ttl / e.ttl) : 0;
              return `<tr data-id="${esc(e.id)}">
              <td><div class="mono trunc" title="${esc(e.domain)}">${esc(e.domain)}</div></td>
              <td><span class="badge muted mono">${esc(e.record_type)}</span></td>
              <td><span class="badge ${e.rcode === "NOERROR" ? "green" : e.rcode === "NXDOMAIN" ? "amber" : "red"}">${esc(e.rcode)}</span></td>
              <td class="r num">${e.answer_count}</td>
              <td><div class="ttl"><span class="meter ${e.stale ? "warn" : ""}"><i style="width:${(ratio * 100).toFixed(0)}%"></i></span><span class="mono sub">${e.stale ? "已过期" : `${e.remaining_ttl}s`}</span></div></td>
              <td class="hide-sm sub">${time(e.last_access_unix_ms)}</td>
              <td><button class="icon-btn sm danger-h" data-del="${esc(e.id)}" title="删除">${icon("x")}</button></td></tr>`;
            })
            .join("")
        : `<tr><td colspan="7"><div class="empty">${icon("db")}缓存为空或无匹配</div></td></tr>`;
      $("#c-foot", root)!.innerHTML = `<span class="sub">显示 ${entries.length} / 共 ${num(total)} 条</span>${cursor ? `<button class="btn ghost sm" id="c-more">加载更多 ${icon("arrowDown")}</button>` : ""}`;
    }

    root.addEventListener("input", debounce(() => load(), 350));
    root.addEventListener("click", async (ev) => {
      const t = ev.target as HTMLElement;
      const tab = t.closest("[data-tag]") as HTMLElement | null;
      if (tab) {
        tag = tab.dataset.tag!;
        root.querySelectorAll("#c-tabs button").forEach((b) => b.classList.toggle("on", b === tab));
        stats();
        return load();
      }
      if (t.closest("#c-more")) return load(true);
      if (t.closest("#c-refresh")) {
        stats();
        return load();
      }
      const d = t.closest("[data-del]") as HTMLElement | null;
      if (d) {
        ev.stopPropagation();
        try {
          await del(plugin(tag, `/entries/${encodeURIComponent(d.dataset.del!)}`));
          entries = entries.filter((x) => x.id !== d.dataset.del);
          total = Math.max(0, total - 1);
          render();
          toast("已删除缓存条目", "ok");
        } catch (e) {
          toast(errMsg(e), "err");
        }
        return;
      }
      if (t.closest("#c-flush")) {
        if (!(await confirmDialog({ title: "清空全部缓存？", body: `将清空 <code>${esc(tag)}</code> 中的所有条目，之后的查询会重新请求上游。`, ok: "清空", danger: true }))) return;
        try {
          await get(plugin(tag, "/flush"));
          toast("缓存已清空", "ok");
          stats();
          load();
        } catch (e) {
          toast(errMsg(e), "err");
        }
        return;
      }
      const tr = t.closest("tr[data-id]") as HTMLElement | null;
      if (tr) {
        const e = entries.find((x) => x.id === tr.dataset.id);
        if (e) showEntry(e);
      }
    });

    stats();
    load();
  },
};

function showEntry(e: CacheEntry) {
  drawer(
    `缓存条目`,
    `<div class="detail-head"><div class="mono big">${esc(e.domain)}</div><div class="row gap"><span class="badge muted mono">${esc(e.record_type)}</span><span class="badge ${e.fresh ? "green" : "amber"}">${e.fresh ? "新鲜" : "过期"}</span></div></div>
    <dl class="kv"><dt>TTL</dt><dd>${e.remaining_ttl}s / ${e.ttl}s</dd><dt>写入时间</dt><dd>${time(e.cache_time_unix_ms, true)}</dd><dt>最近访问</dt><dd>${time(e.last_access_unix_ms, true)}</dd></dl>
    ${
      e.answers_json?.length
        ? `<h4>应答</h4><table class="tbl compact rr"><tbody>${e.answers_json.map((a) => `<tr><td class="mono trunc">${esc(a.name)}</td><td><span class="badge muted mono">${esc(a.rr_type)}</span></td><td class="mono sub r">${a.ttl}s</td><td class="mono brk">${esc(a.payload_text)}</td></tr>`).join("")}</tbody></table>`
        : `<div class="empty sm">没有应答记录</div>`
    }`,
  );
}

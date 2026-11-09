import { del, get, plugin, type QueryRecord, type RecordPayload } from "../api";
import { pluginsOfKind } from "../state";
import { $, confirmDialog, drawer, errMsg, esc, icon, ms, rcodeBadge, time, toast } from "../ui";
import type { Page } from "./page";

const QTYPES = ["", "A", "AAAA", "CNAME", "HTTPS", "SVCB", "MX", "TXT", "NS", "PTR", "SOA", "SRV"];
const RCODES = ["", "NOERROR", "NXDOMAIN", "SERVFAIL", "REFUSED", "FORMERR"];
const RANGES: [string, number][] = [["15 分钟", 900_000], ["1 小时", 3600_000], ["24 小时", 86400_000], ["7 天", 604800_000], ["全部", 0]];

export const queries: Page = {
  title: "查询日志",
  mount(root, params) {
    const recorders = pluginsOfKind("query_recorder");
    if (!recorders.length) {
      root.innerHTML = `<div class="card hint">${icon("list")}<div><b>未发现 query_recorder 插件</b><p>查询日志依赖 <code>query_recorder</code> 插件。添加到配置并在 sequence 中执行它后即可在此查看每一条 DNS 请求。</p></div></div>`;
      return;
    }
    let tag = recorders[0].tag;
    let cursor: string | undefined;
    let rows: QueryRecord[] = [];
    let live = false;
    let timer: number | undefined;
    let ctrl: AbortController | undefined;

    root.innerHTML = `
      <div class="toolbar card">
        <div class="field grow">${icon("search")}<input id="q-name" placeholder="域名包含…" value="${esc(params.get("qname") ?? "")}"></div>
        <div class="field">${icon("server")}<input id="q-client" placeholder="客户端 IP" value="${esc(params.get("client") ?? "")}" style="width:140px"></div>
        <select id="q-type">${QTYPES.map((t) => `<option value="${t}">${t || "全部类型"}</option>`).join("")}</select>
        <select id="q-rcode">${RCODES.map((t) => `<option value="${t}">${t || "全部 RCODE"}</option>`).join("")}</select>
        <select id="q-status"><option value="all">全部状态</option><option value="has_response">有响应</option><option value="no_response">无响应</option><option value="error">出错</option></select>
        <select id="q-range">${RANGES.map(([l, v], i) => `<option value="${v}" ${i === 2 ? "selected" : ""}>${l}</option>`).join("")}</select>
        ${recorders.length > 1 ? `<select id="q-tag">${recorders.map((r) => `<option>${esc(r.tag)}</option>`).join("")}</select>` : ""}
        <div class="spacer"></div>
        <button class="btn ghost" id="q-live" title="每 3 秒自动刷新">${icon("play")}<span>实时</span></button>
        <button class="icon-btn" id="q-refresh" title="刷新">${icon("refresh")}</button>
        <button class="icon-btn danger-h" id="q-clear" title="清空历史">${icon("trash")}</button>
      </div>
      <div class="card flush">
        <table class="tbl hover" id="q-tbl">
          <thead><tr><th style="width:92px">时间</th><th>域名</th><th class="hide-xs" style="width:76px">类型</th><th class="hide-xs" style="width:150px">客户端</th><th style="width:100px">结果</th><th class="hide-sm">应答</th><th class="r" style="width:84px">耗时</th></tr></thead>
          <tbody></tbody>
        </table>
        <div class="tbl-foot" id="q-foot"></div>
      </div>`;

    const tbody = $("#q-tbl tbody", root)!;
    const foot = $("#q-foot", root)!;

    const filters = () => {
      const r = Number(($("#q-range", root) as HTMLSelectElement).value);
      return {
        qname: ($("#q-name", root) as HTMLInputElement).value.trim(),
        client_ip: ($("#q-client", root) as HTMLInputElement).value.trim(),
        qtype: ($("#q-type", root) as HTMLSelectElement).value,
        rcode: ($("#q-rcode", root) as HTMLSelectElement).value,
        status: (($("#q-status", root) as HTMLSelectElement).value || "all").replace("all", ""),
        since_ms: r ? Date.now() - r : undefined,
      };
    };

    async function load(append = false, quiet = false) {
      ctrl?.abort();
      ctrl = new AbortController();
      if (!append) cursor = undefined;
      if (!append && !quiet) tbody.innerHTML = skeletonRows();
      try {
        const res = await get<{ records: QueryRecord[]; next_cursor?: string }>(plugin(tag, "/records"), { ...filters(), limit: 100, cursor }, ctrl.signal);
        rows = append ? rows.concat(res.records) : res.records;
        cursor = res.next_cursor;
        render();
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty">${icon("alert")}${esc(errMsg(e))}</div></td></tr>`;
        foot.innerHTML = "";
      }
    }

    function render() {
      if (!rows.length) {
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty">${icon("search")}没有匹配的查询记录</div></td></tr>`;
        foot.innerHTML = "";
        return;
      }
      tbody.innerHTML = rows.map(rowHtml).join("");
      foot.innerHTML = `<span class="sub">已加载 ${rows.length} 条</span>${cursor ? `<button class="btn ghost sm" id="q-more">加载更多 ${icon("arrowDown")}</button>` : ""}`;
    }

    const reload = () => load();
    root.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).matches("input")) debounced();
    });
    const debounced = (() => {
      let t: number | undefined;
      return () => {
        clearTimeout(t);
        t = window.setTimeout(reload, 350);
      };
    })();
    root.addEventListener("change", (e) => {
      const t = e.target as HTMLElement;
      if (t.id === "q-tag") tag = (t as HTMLSelectElement).value;
      if (t.matches("select")) reload();
    });
    root.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("#q-more")) return load(true);
      if (t.closest("#q-refresh")) return load();
      if (t.closest("#q-live")) {
        live = !live;
        const b = $("#q-live", root)!;
        b.classList.toggle("on", live);
        b.innerHTML = `${icon(live ? "pause" : "play")}<span>${live ? "暂停" : "实时"}</span>`;
        clearInterval(timer);
        if (live) {
          load(false, true);
          timer = window.setInterval(() => load(false, true), 3000);
        }
        return;
      }
      if (t.closest("#q-clear")) {
        if (!(await confirmDialog({ title: "清空查询历史？", body: `将删除 <code>${esc(tag)}</code> 中的全部查询记录，此操作不可撤销。`, ok: "清空", danger: true }))) return;
        try {
          const r = await del(plugin(tag, "/records"));
          toast(`已清空 ${r.cleared_records ?? 0} 条记录`, "ok");
          load();
        } catch (err) {
          toast(errMsg(err), "err");
        }
        return;
      }
      const tr = t.closest("tr[data-id]") as HTMLElement | null;
      if (tr) openDetail(tag, Number(tr.dataset.id));
    });

    load();
    return () => {
      clearInterval(timer);
      ctrl?.abort();
    };
  },
};

function rowHtml(r: QueryRecord) {
  const q = r.questions_json?.[0];
  const ans = (r.answers_json ?? []).filter((a) => a.rr_type !== "RRSIG");
  const summary = ans
    .slice(0, 3)
    .map((a) => `<span class="ans ${a.rr_type === "CNAME" ? "cname" : ""}">${esc(a.payload_text)}</span>`)
    .join("");
  const slow = r.elapsed_ms > 1000 ? "txt-red" : r.elapsed_ms > 200 ? "txt-amber" : "";
  return `<tr data-id="${r.id}">
    <td class="mono sub">${time(r.created_at_ms)}</td>
    <td><div class="mono trunc qn" title="${esc(q?.name)}">${esc(trimDot(q?.name))}</div><div class="xs-only sub mono trunc">${esc(q?.qtype ?? "")} · ${esc(r.client_ip)}</div></td>
    <td class="hide-xs"><span class="badge muted mono">${esc(q?.qtype ?? "—")}</span></td>
    <td class="hide-xs mono trunc">${esc(r.client_ip)}</td>
    <td>${rcodeBadge(r.rcode, r.error, r.has_response)}</td>
    <td class="hide-sm"><div class="ans-row">${summary}${ans.length > 3 ? `<span class="sub">+${ans.length - 3}</span>` : ""}</div></td>
    <td class="r mono ${slow}">${ms(r.elapsed_ms)}</td></tr>`;
}

const trimDot = (s?: string) => (s && s.length > 1 ? s.replace(/\.$/, "") : s ?? "");

function skeletonRows() {
  return Array.from({ length: 8 }, () => `<tr class="sk"><td colspan="7"><div class="skel" style="height:18px"></div></td></tr>`).join("");
}

async function openDetail(tag: string, id: number) {
  const d = drawer(`查询详情 <span class="sub mono">#${id}</span>`, `<div class="skel" style="height:240px"></div>`);
  try {
    const { record: r } = await get<{ record: QueryRecord }>(plugin(tag, `/records/${id}`));
    const q = r.questions_json?.[0];
    d.root.innerHTML = `
      <div class="detail-head">
        <div class="mono big">${esc(trimDot(q?.name))}</div>
        <div class="row gap wrap"><span class="badge muted mono">${esc(q?.qtype)}</span>${rcodeBadge(r.rcode, r.error, r.has_response)}<span class="sub">${ms(r.elapsed_ms)}</span></div>
      </div>
      <dl class="kv">
        <dt>时间</dt><dd>${time(r.created_at_ms, true)}</dd>
        <dt>客户端</dt><dd class="mono">${esc(r.client_ip)}</dd>
        ${r.error ? `<dt>错误</dt><dd class="txt-red">${esc(r.error)}</dd>` : ""}
      </dl>
      ${section("应答 Answer", r.answers_json)}
      ${section("授权 Authority", r.authorities_json)}
      ${section("附加 Additional", (r.additionals_json ?? []).filter((x) => x.rr_type !== "OPT"))}
      ${
        r.steps?.length
          ? `<h4>执行路径</h4><ol class="steps">${r.steps
              .map(
                (s) => `<li class="${/match|true|hit|executed|accept/i.test(s.outcome) ? "hit" : /false|miss|skip/i.test(s.outcome) ? "miss" : ""}">
                <span class="mono">${esc(s.sequence_tag)}${s.node_index != null ? `[${s.node_index}]` : ""}</span>
                <span class="badge muted">${esc(s.kind)}</span>
                ${s.tag ? `<span class="mono">${esc(s.tag)}</span>` : ""}
                <span class="outcome">${esc(s.outcome)}</span></li>`,
              )
              .join("")}</ol>`
          : ""
      }`;
  } catch (e) {
    d.root.innerHTML = `<div class="empty">${icon("alert")}${esc(errMsg(e))}</div>`;
  }
}

function section(title: string, list?: RecordPayload[]) {
  if (!list?.length) return "";
  return `<h4>${title} <span class="sub">${list.length}</span></h4><table class="tbl compact rr"><tbody>${list
    .map((a) => `<tr><td class="mono trunc" title="${esc(a.name)}">${esc(trimDot(a.name))}</td><td><span class="badge muted mono">${esc(a.rr_type)}</span></td><td class="r mono sub">${a.ttl}s</td><td class="mono brk">${esc(a.payload_text)}</td></tr>`)
    .join("")}</tbody></table>`;
}

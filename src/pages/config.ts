import { ApiError, get, post, req } from "../api";
import { loadConfig, parsePlugins, state } from "../state";
import { $, ago, confirmDialog, errMsg, esc, icon, toast } from "../ui";
import { watchReload } from "../shell";
import type { Page } from "./page";

interface Diag {
  message: string;
  severity: string;
  line: number;
  column: number;
}

let dirtyGuard: (() => boolean) | null = null;
export const configDirty = () => dirtyGuard?.() ?? false;

export const config: Page = {
  title: "配置",
  mount(root) {
    let base = state.config?.content ?? "";
    let version = state.config?.version ?? "";
    let diags: Diag[] = [];

    root.innerHTML = `
      <div class="toolbar card">
        <div class="cfg-path"><span class="mono" id="cf-path">${esc(state.config?.path ?? "")}</span><span class="sub" id="cf-meta"></span></div>
        <div class="spacer"></div>
        <span class="badge amber hidden" id="cf-dirty">未保存</span>
        <button class="btn ghost" id="cf-revert" title="放弃修改">${icon("refresh")}<span>还原</span></button>
        <button class="btn ghost" id="cf-validate">${icon("check")}<span>校验</span></button>
        <button class="btn ghost" id="cf-save">${icon("save")}<span>保存</span></button>
        <button class="btn primary" id="cf-apply" title="保存并热重载 (Ctrl+S)">${icon("zap")}<span>保存并应用</span></button>
      </div>
      <div id="cf-diags"></div>
      <div class="editor card flush">
        <div class="gutter" id="cf-gutter"></div>
        <div class="code-wrap">
          <pre class="hl" id="cf-hl" aria-hidden="true"></pre>
          <textarea id="cf-ta" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off"></textarea>
        </div>
      </div>`;

    const ta = $("#cf-ta", root) as HTMLTextAreaElement;
    const hl = $("#cf-hl", root)!;
    const gutter = $("#cf-gutter", root)!;
    ta.value = base;

    const setMeta = () => {
      $("#cf-meta", root)!.textContent = state.config?.updated_at_ms ? ` · 修改于 ${ago(state.config.updated_at_ms)}` : "";
    };
    setMeta();

    const paint = () => {
      const text = ta.value;
      hl.innerHTML = highlight(text) + "\n";
      const lines = text.split("\n").length;
      const bad = new Set(diags.map((d) => d.line));
      let g = "";
      for (let i = 1; i <= lines; i++) g += `<div class="${bad.has(i) ? "bad" : ""}">${i}</div>`;
      gutter.innerHTML = g;
      $("#cf-dirty", root)!.classList.toggle("hidden", text === base);
    };
    const sync = () => {
      hl.scrollTop = ta.scrollTop;
      hl.scrollLeft = ta.scrollLeft;
      gutter.scrollTop = ta.scrollTop;
    };
    ta.addEventListener("input", paint);
    ta.addEventListener("scroll", sync);
    ta.addEventListener("keydown", (e) => {
      if (e.key === "Tab") {
        e.preventDefault();
        const s = ta.selectionStart, en = ta.selectionEnd;
        ta.setRangeText("  ", s, en, "end");
        paint();
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save(true);
      }
    });
    paint();
    dirtyGuard = () => ta.isConnected && ta.value !== base;

    const showDiags = (list: Diag[], message?: string) => {
      diags = list;
      const el = $("#cf-diags", root)!;
      if (!list.length && !message) {
        el.innerHTML = "";
      } else {
        el.innerHTML = `<div class="card diag"><div class="card-h"><h2>${icon("alert")}${esc(message ?? "配置存在问题")}</h2></div><ul>${list
          .map((d) => `<li data-line="${d.line}" class="${esc(d.severity)}"><span class="mono">L${d.line}:${d.column}</span>${esc(d.message)}</li>`)
          .join("")}</ul></div>`;
        if (list[0]) jumpTo(ta, list[0].line);
      }
      paint();
    };

    const fromError = (e: unknown) => {
      if (e instanceof ApiError && e.body) {
        const details: Diag[] = Array.isArray(e.body.diagnostic_details) ? e.body.diagnostic_details : [];
        if (details.length) return showDiags(details, e.message);
        if (Array.isArray(e.body.diagnostics)) return showDiags([], [e.message, ...e.body.diagnostics.filter((x: string) => x !== e.message)].join("\n"));
      }
      showDiags([], errMsg(e));
    };

    async function validate() {
      try {
        const r = await post("/config/validate", { format: "yaml", content: ta.value });
        showDiags([]);
        toast(`校验通过：${r.plugin_count} 个插件`, "ok");
        return true;
      } catch (e) {
        fromError(e);
        return false;
      }
    }

    async function save(reload: boolean) {
      const btn = $(reload ? "#cf-apply" : "#cf-save", root)!;
      btn.classList.add("loading");
      try {
        const r = await req("PUT", "/config", { json: { format: "yaml", content: ta.value, base_version: version || undefined, validate: true, reload } });
        base = ta.value;
        version = r.version;
        state.config = { path: r.path, content: base, version, updated_at_ms: r.updated_at_ms };
        state.plugins = parsePlugins(base);
        showDiags([]);
        setMeta();
        toast(reload ? "已保存，正在应用…" : "配置已保存（未重载）", "ok");
        if (reload) watchReload();
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) {
          const ok = await confirmDialog({ title: "配置已被其他人修改", body: "服务器上的配置文件在你打开后发生了变化。要强制覆盖吗？", ok: "强制覆盖", danger: true });
          if (ok) {
            version = "";
            btn.classList.remove("loading");
            return save(reload);
          }
        } else fromError(e);
      } finally {
        btn.classList.remove("loading");
      }
    }

    root.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("#cf-validate")) validate();
      else if (t.closest("#cf-save")) save(false);
      else if (t.closest("#cf-apply")) save(true);
      else if (t.closest("#cf-revert")) {
        if (ta.value !== base && !(await confirmDialog({ title: "放弃未保存的修改？", ok: "放弃", danger: true }))) return;
        try {
          const c = await loadConfig();
          base = c.content;
          version = c.version;
          ta.value = base;
          showDiags([]);
          setMeta();
        } catch (err) {
          toast(errMsg(err), "err");
        }
      } else {
        const li = t.closest("[data-line]") as HTMLElement | null;
        if (li) jumpTo(ta, Number(li.dataset.line));
      }
    });

    // Refresh from server if we have nothing yet.
    if (!state.config) get("/config").then((c) => { state.config = c; base = ta.value = c.content; version = c.version; paint(); }).catch((e) => toast(errMsg(e), "err"));

    const before = (e: BeforeUnloadEvent) => {
      if (ta.value !== base) e.preventDefault();
    };
    window.addEventListener("beforeunload", before);
    return () => {
      window.removeEventListener("beforeunload", before);
    };
  },
};

function jumpTo(ta: HTMLTextAreaElement, line: number) {
  const lines = ta.value.split("\n");
  let pos = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) pos += lines[i].length + 1;
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(pos, pos + (lines[line - 1]?.length ?? 0));
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, (line - 6) * lh);
}

/** Minimal YAML syntax highlighter (line based). */
function highlight(text: string) {
  return text
    .split("\n")
    .map((line) => {
      const ci = commentIndex(line);
      const code = ci >= 0 ? line.slice(0, ci) : line;
      const comment = ci >= 0 ? `<span class="t-c">${esc(line.slice(ci))}</span>` : "";
      const m = /^(\s*(?:-\s+)?)([\w.\-$]+|"[^"]*"|'[^']*')(\s*:)(?=\s|$)(.*)$/.exec(code);
      if (m) return `${lead(m[1])}<span class="t-k">${esc(m[2])}</span>${esc(m[3])}${value(m[4])}${comment}`;
      const li = /^(\s*-\s+)(.*)$/.exec(code);
      if (li) return `${lead(li[1])}${value(li[2])}${comment}`;
      return value(code) + comment;
    })
    .join("\n");
}
const lead = (s: string) => esc(s).replace("-", '<span class="t-p">-</span>');
function value(v: string) {
  if (!v.trim()) return esc(v);
  const lw = v.match(/^\s*/)![0];
  const s = v.slice(lw.length);
  let cls = "t-v";
  if (/^["']/.test(s)) cls = "t-s";
  else if (/^!?\$/.test(s)) cls = "t-r";
  else if (/^(true|false|null|~)$/i.test(s)) cls = "t-b";
  else if (/^-?\d[\d_.]*(ms|s|m|h|d)?$/.test(s)) cls = "t-n";
  else if (/^[|>][-+]?$/.test(s)) cls = "t-p";
  else if (/^[\[{]/.test(s)) cls = "t-v";
  return esc(lw) + `<span class="${cls}">${esc(s).replace(/(!?\$[\w\-]+)/g, '<span class="t-r">$1</span>')}</span>`;
}
function commentIndex(line: string) {
  let q: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) q = null;
    } else if (c === '"' || c === "'") q = c;
    else if (c === "#" && (i === 0 || /\s/.test(line[i - 1]))) return i;
  }
  return -1;
}

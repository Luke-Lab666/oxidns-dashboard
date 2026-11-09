import { conn, forgetConn, get, post, req, saveConn, setUnauthorizedHandler, type Health, type Reload } from "./api";
import { loadBuild, loadConfig, state } from "./state";
import { $, confirmDialog, dur, errMsg, esc, icon, toast } from "./ui";
import type { Page } from "./pages/page";
import { overview } from "./pages/overview";
import { queries } from "./pages/queries";
import { cache } from "./pages/cache";
import { plugins } from "./pages/plugins";
import { config, configDirty } from "./pages/config";
import { logs } from "./pages/logs";
import { system } from "./pages/system";

const ROUTES: { path: string; page: Page; icon: string }[] = [
  { path: "overview", page: overview, icon: "gauge" },
  { path: "queries", page: queries, icon: "list" },
  { path: "cache", page: cache, icon: "db" },
  { path: "plugins", page: plugins, icon: "puzzle" },
  { path: "config", page: config, icon: "file" },
  { path: "logs", page: logs, icon: "terminal" },
  { path: "system", page: system, icon: "settings" },
];

let cleanup: (() => void) | void;
let current = "";
let healthTimer: number | undefined;

// ---------- theme ----------
function applyTheme(t: string) {
  document.documentElement.dataset.theme = t;
  try {
    localStorage.setItem("oxidns-dashboard.theme", t);
  } catch {
    /* ignore */
  }
}
function initTheme() {
  let t = "";
  try {
    t = localStorage.getItem("oxidns-dashboard.theme") ?? "";
  } catch {
    /* ignore */
  }
  applyTheme(t || (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark"));
}

// ---------- boot ----------
export async function boot() {
  initTheme();
  setUnauthorizedHandler(() => showLogin("登录已失效，请重新输入凭据"));
  try {
    await req<Health>("GET", "/health", { silent401: true });
    await enter();
  } catch (e) {
    showLogin((e as any)?.status === 401 ? (conn.user ? "用户名或密码错误" : "") : conn.user || conn.base !== "/api" ? errMsg(e) : "");
  }
}

async function enter() {
  await loadBuild();
  try {
    await loadConfig();
  } catch (e) {
    toast("读取配置失败：" + errMsg(e), "err");
  }
  renderShell();
  window.onhashchange = () => route();
  route();
  pollHealth();
}

// ---------- login ----------
function showLogin(error = "") {
  clearInterval(healthTimer);
  cleanup?.();
  cleanup = undefined;
  current = "";
  window.onhashchange = null;
  document.body.innerHTML = `
    <div class="login">
      <form class="login-card" autocomplete="on">
        <div class="brand lg">${logo()}<div><b>OxiDNS</b><span>Dashboard</span></div></div>
        <p class="sub">连接到你的 OxiDNS 管理 API</p>
        <label>API 地址<input name="base" value="${esc(conn.base)}" placeholder="/api 或 http://192.168.1.1:9199/api" required></label>
        <div class="two">
          <label>用户名<input name="user" value="${esc(conn.user)}" placeholder="可选" autocomplete="username"></label>
          <label>密码<input name="pass" type="password" value="${esc(conn.pass)}" placeholder="可选" autocomplete="current-password"></label>
        </div>
        <label class="check"><input type="checkbox" name="remember" checked> 在此浏览器记住</label>
        <div class="login-err ${error ? "" : "hidden"}">${icon("alert")}<span>${esc(error)}</span></div>
        <button class="btn primary block" type="submit">${icon("zap")}连接</button>
        <p class="hint-sm">与 OxiDNS 同源部署（反向代理 <code>/api</code>）时保持默认即可。跨域访问并启用了 Basic 认证时，浏览器会拦截 <code>Authorization</code> 头，请改用反向代理。</p>
      </form>
    </div>`;
  const form = $("form") as HTMLFormElement;
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    let base = String(fd.get("base") ?? "").trim() || "/api";
    if (/^https?:\/\/[^/]+\/?$/.test(base)) base = base.replace(/\/?$/, "/api");
    saveConn({ base, user: String(fd.get("user") ?? "").trim(), pass: String(fd.get("pass") ?? "") }, !!fd.get("remember"));
    const btn = form.querySelector("button")!;
    btn.classList.add("loading");
    const err = form.querySelector(".login-err")!;
    try {
      await req("GET", "/health", { silent401: true });
      // /health may be public; probe a protected route too.
      await req("GET", "/build", { silent401: true }).catch((e2) => {
        if (e2?.status === 401) throw e2;
      });
      await enter();
    } catch (e2) {
      err.classList.remove("hidden");
      err.querySelector("span")!.textContent = (e2 as any)?.status === 401 ? "用户名或密码错误" : errMsg(e2);
    } finally {
      btn.classList.remove("loading");
    }
  });
}

export function logout() {
  forgetConn();
  showLogin();
}

// ---------- layout ----------
function logo() {
  return `<svg class="logo" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--acc)"/><stop offset="1" stop-color="var(--acc2)"/></linearGradient></defs><rect x="2" y="2" width="28" height="28" rx="8" fill="url(#lg)"/><circle cx="16" cy="16" r="6.5" fill="none" stroke="var(--on-acc)" stroke-width="2.4"/><circle cx="16" cy="16" r="2" fill="var(--on-acc)"/><path d="M16 4.5v5M16 22.5v5M4.5 16h5M22.5 16h5" stroke="var(--on-acc)" stroke-width="2.4" stroke-linecap="round" opacity=".55"/></svg>`;
}

function renderShell() {
  document.body.innerHTML = `
    <div class="app">
      <aside class="side" id="side">
        <div class="brand">${logo()}<div><b>OxiDNS</b><span id="ver">${esc(state.build?.version ?? "")}</span></div></div>
        <nav>${ROUTES.map((r) => `<a href="#/${r.path}" data-path="${r.path}">${icon(r.icon)}<span>${r.page.title}</span></a>`).join("")}</nav>
        <div class="side-foot"><div class="health" id="health"><i></i><span>检查中…</span></div></div>
      </aside>
      <div class="side-mask" id="side-mask"></div>
      <main class="main">
        <header class="top">
          <button class="icon-btn mobile-only" id="menu" title="菜单">${icon("menu")}</button>
          <h1 id="title"></h1>
          <div class="spacer"></div>
          <div class="reload-state hidden" id="reload-state"></div>
          <button class="icon-btn" id="btn-reload" title="热重载配置">${icon("refresh")}</button>
          <button class="icon-btn" id="btn-theme" title="切换主题">${icon(document.documentElement.dataset.theme === "light" ? "moon" : "sun")}</button>
        </header>
        <div class="content" id="content"></div>
      </main>
    </div>`;
  $("#btn-theme")!.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
    applyTheme(next);
    $("#btn-theme")!.innerHTML = icon(next === "light" ? "moon" : "sun");
  });
  $("#btn-reload")!.addEventListener("click", async () => {
    try {
      await post("/reload");
      watchReload();
    } catch (e) {
      toast(errMsg(e), "err");
    }
  });
  const toggle = (open?: boolean) => $("#side")!.classList.toggle("open", open);
  $("#menu")!.addEventListener("click", () => toggle());
  $("#side-mask")!.addEventListener("click", () => toggle(false));
  $("#side nav")!.addEventListener("click", () => toggle(false));
}

async function route(force = false) {
  const raw = location.hash.replace(/^#\/?/, "");
  const [path, query] = raw.split("?");
  const r = ROUTES.find((x) => x.path === path) ?? ROUTES[0];
  const key = r.path + "?" + (query ?? "");
  if (!force && key === current) return;
  if (current.startsWith("config") && r.path !== "config" && configDirty() && !(await confirmDialog({ title: "配置有未保存的修改", body: "离开后修改会丢失。", ok: "仍然离开", danger: true }))) {
    history.replaceState(null, "", "#/config");
    return;
  }
  current = key;
  cleanup?.();
  document.querySelectorAll(".drawer-wrap").forEach((d) => d.remove());
  document.querySelectorAll("#side nav a").forEach((a) => a.classList.toggle("on", (a as HTMLElement).dataset.path === r.path));
  $("#title")!.textContent = r.page.title;
  document.title = `${r.page.title} · OxiDNS`;
  const content = $("#content")!;
  const fresh = content.cloneNode(false) as HTMLElement; // drop old listeners
  content.replaceWith(fresh);
  fresh.classList.add("enter");
  cleanup = r.page.mount(fresh, new URLSearchParams(query ?? ""));
  requestAnimationFrame(() => fresh.classList.remove("enter"));
}

// ---------- health ----------
function pollHealth() {
  const tick = async () => {
    const el = $("#health");
    if (!el) return;
    try {
      const h = await get<Health>("/health");
      const ok = h.status === "ok" || h.status === "healthy" || h.status === "ready";
      el.className = `health ${ok ? "ok" : "warn"}`;
      el.querySelector("span")!.innerHTML = `${ok ? "运行正常" : esc(h.status)} <em>· ${dur(h.uptime_ms)}</em>`;
      el.title = Object.entries(h.checks ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n");
      if ($("#ver") && !$("#ver")!.textContent) $("#ver")!.textContent = h.version;
    } catch {
      el.className = "health bad";
      el.querySelector("span")!.textContent = "无法连接";
    }
  };
  tick();
  clearInterval(healthTimer);
  healthTimer = window.setInterval(tick, 15000);
}

// ---------- reload / restart ----------
let watching = false;
export async function watchReload() {
  if (watching) return;
  watching = true;
  const el = $("#reload-state");
  const show = (html: string, cls = "") => {
    if (!el) return;
    el.className = `reload-state ${cls}`;
    el.innerHTML = html;
  };
  show(`<span class="spin"></span>重载中…`, "busy");
  const started = Date.now();
  try {
    for (;;) {
      await new Promise((r) => setTimeout(r, 700));
      let s: Reload;
      try {
        s = await get<Reload>("/reload/status");
      } catch {
        continue;
      }
      if (!s.pending && !s.in_progress && (s.last_completed_ms ?? 0) >= started - 2000) {
        if (s.last_error && (s.last_success_ms ?? 0) < (s.last_completed_ms ?? 0)) {
          show(`${icon("alert")}重载失败`, "err");
          toast("重载失败：" + s.last_error, "err", 8000);
        } else {
          show(`${icon("check")}已应用`, "ok");
          toast("配置已重载生效", "ok");
          await loadConfig().catch(() => {});
          route(true);
        }
        break;
      }
      if (Date.now() - started > 60000) {
        show(`${icon("alert")}重载超时`, "err");
        break;
      }
    }
  } finally {
    watching = false;
    setTimeout(() => el?.classList.add("hidden"), 4000);
  }
}

export async function restart() {
  if (!(await confirmDialog({ title: "重启 OxiDNS？", body: "进程将完整重启，DNS 服务会短暂中断。", ok: "重启", danger: true }))) return;
  try {
    await post("/restart");
    toast("正在重启，稍后自动重新连接…", "info", 6000);
    const h = $("#health");
    if (h) {
      h.className = "health warn";
      h.querySelector("span")!.textContent = "重启中…";
    }
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      try {
        await get("/health");
        toast("OxiDNS 已重新上线", "ok");
        await loadConfig().catch(() => {});
        route(true);
        return;
      } catch {
        /* still down */
      }
    }
  } catch (e) {
    toast(errMsg(e), "err");
  }
}

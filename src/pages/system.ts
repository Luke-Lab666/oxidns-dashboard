import { conn, get, post, type SystemInfo } from "../api";
import { state } from "../state";
import { $, confirmDialog, dur, errMsg, esc, icon, time, toast } from "../ui";
import { logout, restart, watchReload } from "../shell";
import type { Page } from "./page";
import { bindPicker, pickerHtml } from "../appearance";

export const system: Page = {
  title: "系统",
  mount(root) {
    const b = state.build;
    const hasUpgrade = !!b?.enabled_features?.includes("plugin-upgrade");
    root.innerHTML = `
      <section class="grid-2">
        <div class="card"><div class="card-h"><h2>${icon("server")}实例</h2></div><div class="card-b" id="s-info"><div class="skel" style="height:160px"></div></div></div>
        <div class="card"><div class="card-h"><h2>${icon("power")}操作</h2></div><div class="card-b">
          <div class="actions">
            <div><b>热重载配置</b><p class="sub">重新读取配置文件并重建插件，不中断监听。</p></div><button class="btn ghost" id="s-reload">${icon("refresh")}重载</button>
            <div><b>重启进程</b><p class="sub">完整重启 OxiDNS，期间 DNS 服务会短暂中断。</p></div><button class="btn danger-o" id="s-restart">${icon("power")}重启</button>
            ${hasUpgrade ? `<div><b>在线升级</b><p class="sub" id="s-up-msg">从 GitHub Releases 检查新版本。</p></div><button class="btn ghost" id="s-up">${icon("download")}检查更新</button>` : ""}
          </div>
        </div></div>
      </section>
      <section class="card"><div class="card-h"><h2>${icon("palette")}外观</h2><span class="sub">保存在当前浏览器</span></div><div class="card-b" id="s-look"></div></section>
      <section class="grid-2">
        <div class="card"><div class="card-h"><h2>${icon("globe")}连接</h2></div><div class="card-b">
          <dl class="kv"><dt>API 地址</dt><dd class="mono brk">${esc(new URL(conn.base, location.href).href)}</dd><dt>认证</dt><dd>${conn.user ? `Basic · <span class="mono">${esc(conn.user)}</span>` : "无"}</dd></dl>
          <button class="btn ghost" id="s-logout">${icon("logout")}断开 / 切换实例</button>
        </div></div>
        <div class="card"><div class="card-h"><h2>${icon("layers")}构建</h2></div><div class="card-b">
          ${
            b
              ? `<dl class="kv"><dt>版本</dt><dd class="mono">${esc(b.version)}</dd><dt>Bundle</dt><dd>${esc(b.bundle)}</dd><dt>插件支持</dt><dd>服务 ${b.supported_plugins.servers.length} · 执行器 ${b.supported_plugins.executors.length} · 匹配器 ${b.supported_plugins.matchers.length} · 数据源 ${b.supported_plugins.providers.length}</dd></dl>
                 <details><summary>已启用特性（${b.enabled_features.length}）</summary><div class="chips-wrap">${b.enabled_features.map((f) => `<span class="badge muted mono">${esc(f)}</span>`).join("")}</div></details>`
              : `<div class="empty sm">无法读取 /build</div>`
          }
        </div></div>
      </section>`;

    const look = $("#s-look", root)!;
    const renderLook = () => (look.innerHTML = pickerHtml());
    renderLook();
    bindPicker(look, renderLook);

    get<SystemInfo>("/system")
      .then((s) => {
        const r = s.reload;
        $("#s-info", root)!.innerHTML = `<dl class="kv">
          <dt>版本</dt><dd class="mono">${esc(s.version)}</dd>
          <dt>平台</dt><dd>${esc(s.os)} / ${esc(s.arch)}</dd>
          <dt>运行时长</dt><dd>${dur(s.uptime_ms)}</dd>
          <dt>配置文件</dt><dd class="mono brk">${esc(s.config_path)}</dd>
          <dt>内存</dt><dd>${s.process_memory_mb != null ? `${s.process_memory_mb.toFixed(1)} MB <span class="sub">${esc(s.process_memory_kind ?? "")}</span>` : "—"}</dd>
          <dt>上次重载</dt><dd>${r?.last_success_ms ? time(r.last_success_ms, true) : "—"}${r?.last_error ? `<div class="txt-red brk">${esc(r.last_error)}</div>` : ""}</dd>
          ${r?.running_version ? `<dt>配置版本</dt><dd class="mono sub">${esc(r.running_version.slice(0, 16))}</dd>` : ""}
        </dl>`;
      })
      .catch((e) => ($("#s-info", root)!.innerHTML = `<div class="empty sm">${esc(errMsg(e))}</div>`));

    root.addEventListener("click", async (e) => {
      const t = e.target as HTMLElement;
      if (t.closest("#s-reload")) {
        try {
          await post("/reload");
          watchReload();
        } catch (err) {
          toast(errMsg(err), "err");
        }
      }
      if (t.closest("#s-restart")) restart();
      if (t.closest("#s-logout")) logout();
      const up = t.closest("#s-up") as HTMLElement | null;
      if (up) {
        up.classList.add("loading");
        try {
          const c = await post("/upgrade/check", {});
          const msg = $("#s-up-msg", root)!;
          if (!c.update_available) {
            msg.innerHTML = `当前已是最新版本 <span class="mono">${esc(c.current_version)}</span>`;
            toast("已是最新版本", "ok");
          } else {
            msg.innerHTML = `发现新版本 <b class="mono">${esc(c.latest_version)}</b>（当前 ${esc(c.current_version)}）${c.release_url ? ` · <a href="${esc(c.release_url)}" target="_blank" rel="noopener">更新说明</a>` : ""}`;
            if (await confirmDialog({ title: `升级到 ${c.latest_version}？`, body: `将下载 <code>${esc(c.asset_name)}</code> 并替换当前程序，完成后自动重启。`, ok: "开始升级" })) {
              await post("/upgrade/apply", {});
              toast("升级已开始，完成后服务会自动重启", "info", 6000);
              pollUpgrade(msg);
            }
          }
        } catch (err) {
          toast(errMsg(err), "err");
        } finally {
          up.classList.remove("loading");
        }
      }
    });
  },
};

async function pollUpgrade(msg: HTMLElement) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const s = await get("/upgrade/status");
      msg.textContent = `升级状态：${s.state}${s.error ? ` · ${s.error}` : ""}`;
      if (["completed", "failed", "skipped"].includes(s.state)) return;
    } catch {
      msg.textContent = "服务重启中…";
    }
  }
}

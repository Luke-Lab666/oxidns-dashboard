import { get, streamLogs, type LogEntry } from "../api";
import { $, errMsg, esc, icon } from "../ui";
import type { Page } from "./page";

const LEVELS = ["TRACE", "DEBUG", "INFO", "WARN", "ERROR"];
const MAX = 2000;

export const logs: Page = {
  title: "运行日志",
  mount(root) {
    let level = "INFO";
    let paused = false;
    let follow = true;
    let filter = "";
    let entries: LogEntry[] = [];
    let ctrl: AbortController | null = null;
    let pending = false;

    root.innerHTML = `
      <div class="toolbar card">
        <div class="seg" id="l-level">${LEVELS.map((l) => `<button data-l="${l}" class="${l === level ? "on" : ""} lv-${l}">${l}</button>`).join("")}</div>
        <div class="field grow">${icon("search")}<input id="l-q" placeholder="过滤日志内容 / target…"></div>
        <span class="conn" id="l-conn"><i></i><span>连接中</span></span>
        <button class="btn ghost" id="l-pause">${icon("pause")}<span>暂停</span></button>
        <button class="icon-btn" id="l-clear" title="清屏">${icon("trash")}</button>
      </div>
      <div class="card flush logbox" id="l-box"><div class="loglines" id="l-lines"></div></div>
      <button class="btn primary jump hidden" id="l-jump">${icon("arrowDown")}回到底部</button>`;

    const box = $("#l-box", root)!;
    const lines = $("#l-lines", root)!;
    const setConn = (s: "on" | "off" | "wait", txt: string) => {
      const el = $("#l-conn", root)!;
      el.className = `conn ${s}`;
      el.querySelector("span")!.textContent = txt;
    };

    const line = (e: LogEntry) =>
      `<div class="ll lv-${e.level}"><span class="lt">${esc(fmtTs(e.timestamp))}</span><span class="lvl">${e.level}</span><span class="tg" title="${esc(e.target)}">${esc(shortTarget(e.target))}</span><span class="lm">${esc(e.message)}</span></div>`;
    const matches = (e: LogEntry) => !filter || `${e.message} ${e.target}`.toLowerCase().includes(filter);

    const renderAll = () => {
      lines.innerHTML = entries.filter(matches).map(line).join("") || `<div class="empty sm">暂无日志</div>`;
      if (follow) box.scrollTop = box.scrollHeight;
    };
    let buffer: LogEntry[] = [];
    const flush = () => {
      pending = false;
      if (!buffer.length) return;
      const add = buffer;
      buffer = [];
      entries.push(...add);
      if (entries.length > MAX) {
        entries = entries.slice(-MAX);
        return renderAll();
      }
      if (lines.querySelector(".empty")) lines.innerHTML = "";
      lines.insertAdjacentHTML("beforeend", add.filter(matches).map(line).join(""));
      while (lines.childElementCount > MAX) lines.firstElementChild?.remove();
      if (follow) box.scrollTop = box.scrollHeight;
    };

    async function connect() {
      ctrl?.abort();
      ctrl = new AbortController();
      const my = ctrl;
      entries = [];
      renderAll();
      setConn("wait", "连接中");
      try {
        // Seed with recent history, then stream new entries.
        const recent = await get<{ entries: LogEntry[] }>("/logs", { level, limit: 300 }, my.signal).catch(() => null);
        if (recent?.entries) {
          entries = recent.entries.slice().sort((a, b) => a.id - b.id);
          renderAll();
        }
        const lastId = entries.at(-1)?.id ?? -1;
        setConn("on", "实时");
        await streamLogs(
          { level, tail: 0 },
          (e) => {
            if (e.id <= lastId || paused) return;
            buffer.push(e);
            if (!pending) {
              pending = true;
              requestAnimationFrame(flush);
            }
          },
          my.signal,
        );
        if (!my.signal.aborted) {
          setConn("off", "已断开，重连中…");
          setTimeout(() => !my.signal.aborted && connect(), 3000);
        }
      } catch (e: any) {
        if (my.signal.aborted) return;
        setConn("off", errMsg(e));
        setTimeout(() => !my.signal.aborted && connect(), 5000);
      }
    }

    box.addEventListener("scroll", () => {
      follow = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
      $("#l-jump", root)!.classList.toggle("hidden", follow);
    });
    root.addEventListener("input", (e) => {
      if ((e.target as HTMLElement).id === "l-q") {
        filter = (e.target as HTMLInputElement).value.trim().toLowerCase();
        renderAll();
      }
    });
    root.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const lb = t.closest("[data-l]") as HTMLElement | null;
      if (lb) {
        level = lb.dataset.l!;
        root.querySelectorAll("#l-level button").forEach((b) => b.classList.toggle("on", b === lb));
        return connect();
      }
      if (t.closest("#l-pause")) {
        paused = !paused;
        const b = $("#l-pause", root)!;
        b.classList.toggle("on", paused);
        b.innerHTML = `${icon(paused ? "play" : "pause")}<span>${paused ? "继续" : "暂停"}</span>`;
        setConn(paused ? "wait" : "on", paused ? "已暂停" : "实时");
      }
      if (t.closest("#l-clear")) {
        entries = [];
        renderAll();
      }
      if (t.closest("#l-jump")) {
        follow = true;
        box.scrollTop = box.scrollHeight;
      }
    });

    connect();
    return () => ctrl?.abort();
  },
};

function fmtTs(ts: string) {
  const d = new Date(ts);
  if (isNaN(+d)) return ts;
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function shortTarget(t: string) {
  const parts = t.split("::");
  return parts.length > 2 ? parts.slice(-2).join("::") : t;
}

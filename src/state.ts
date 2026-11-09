import * as yaml from "js-yaml";
import { get, req, type BuildInfo } from "./api";

export type PluginType = "server" | "executor" | "matcher" | "provider" | "unknown";

export interface PluginInfo {
  tag: string;
  kind: string;
  type: PluginType;
  args: unknown;
}

export interface ConfigFile {
  path: string;
  content: string;
  version: string;
  updated_at_ms?: number;
}

export const state = {
  build: null as BuildInfo | null,
  config: null as ConfigFile | null,
  plugins: [] as PluginInfo[],
  configError: "" as string,
};

export async function loadBuild() {
  try {
    const r = await get<{ build: BuildInfo }>("/build");
    state.build = r.build;
  } catch {
    state.build = null;
  }
}

export async function loadConfig() {
  const r = await get<ConfigFile>("/config");
  state.config = r;
  state.plugins = parsePlugins(r.content);
  return r;
}

export function parsePlugins(text: string): PluginInfo[] {
  try {
    const doc = yaml.load(text) as any;
    state.configError = "";
    const list = Array.isArray(doc?.plugins) ? doc.plugins : [];
    return list
      .filter((p: any) => p && typeof p === "object" && p.tag)
      .map((p: any) => {
        const kind = String(p.type ?? p.kind ?? "");
        return { tag: String(p.tag), kind, type: classify(kind), args: p.args };
      });
  } catch (e: any) {
    state.configError = e?.message ?? String(e);
    return [];
  }
}

export function classify(kind: string): PluginType {
  const s = state.build?.supported_plugins;
  if (s) {
    if (s.servers.includes(kind)) return "server";
    if (s.matchers.includes(kind)) return "matcher";
    if (s.providers.includes(kind)) return "provider";
    if (s.executors.includes(kind)) return "executor";
  }
  if (kind.endsWith("_server")) return "server";
  if (/_set$|^geo|adguard/.test(kind)) return "provider";
  return s ? "unknown" : "executor";
}

export const pluginsOfKind = (kind: string) => state.plugins.filter((p) => p.kind === kind);

// ---------- Prometheus ----------

export interface Sample {
  name: string;
  labels: Record<string, string>;
  value: number;
}

export function parseProm(text: string): Sample[] {
  const out: Sample[] = [];
  const lineRe = /^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)/;
  const labelRe = /([a-zA-Z_]\w*)="((?:[^"\\]|\\.)*)"/g;
  for (const line of text.split("\n")) {
    if (!line || line[0] === "#") continue;
    const m = lineRe.exec(line);
    if (!m) continue;
    const labels: Record<string, string> = {};
    if (m[2]) for (const lm of m[2].matchAll(labelRe)) labels[lm[1]] = lm[2].replace(/\\(.)/g, (_, c) => (c === "n" ? "\n" : c));
    const value = Number(m[3]);
    if (Number.isFinite(value)) out.push({ name: m[1], labels, value });
  }
  return out;
}

export async function loadMetrics(): Promise<Sample[] | null> {
  try {
    return parseProm(await req<string>("GET", "/metrics", { text: true }));
  } catch {
    return null;
  }
}

export function sum(samples: Sample[], name: string, where: (l: Record<string, string>) => boolean = () => true) {
  let t = 0;
  let found = false;
  for (const s of samples)
    if (s.name === name && where(s.labels)) {
      t += s.value;
      found = true;
    }
  return found ? t : null;
}

export function byTag(samples: Sample[], tag: string) {
  return samples.filter((s) => s.labels.plugin_tag === tag);
}

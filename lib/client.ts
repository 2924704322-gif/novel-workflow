"use client";

import type {
  ApiConfig,
  Project,
  ProjectSummary,
  StoryArchive,
  StoryBible,
  StyleCard,
  Volume,
} from "./types";
import type {
  ReconcileChange,
  ReconcilePayload,
  ReconcileResult,
} from "./reconcile";
import type { RecentSummary } from "./retrieval";
import type { DocMeta, DocRecord } from "./docsStore";
import type { ApplyResult } from "./studioActions";
import type { MdDraft } from "./agent/types";
import { CLIENT_DEFAULT_TEMPERATURE } from "./constants";

const CONFIG_KEY = "novel-workflow.apiConfig"; // legacy single-config key (auto-migrated)
const PROFILES_KEY = "novel-workflow.apiProfiles";
const RECONCILE_PREF_KEY = "novel-workflow.autoReconcile";

// 云就绪接缝①（系统规范 §2）：API Base URL。
// 客户端所有 fetch 统一经 apiUrl() 拼接 apiBase。默认空串 = 相对路径，
// 即请求打到当前本地服务端口（与今天完全一致）；未来上云只需把 apiBase 设为
// 云端域名，无需改动任何调用处。归属 Sub A（后端）落地基础设施，Sub B 只消费。
const API_BASE_KEY = "novel-workflow.apiBase";

export function getApiBase(): string {
  if (typeof window === "undefined") return "";
  return (localStorage.getItem(API_BASE_KEY) || "").replace(/\/+$/, "");
}

export function setApiBase(url: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(API_BASE_KEY, (url || "").trim().replace(/\/+$/, ""));
}

// 把以 "/" 开头的 API 路径拼上生效的 apiBase。base 为空时原样返回相对路径。
export function apiUrl(path: string): string {
  const base = getApiBase();
  if (!base) return path;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

export const DEFAULT_CONFIG: ApiConfig = {
  baseUrl: "https://api.deepseek.com/v1",
  apiKey: "",
  model: "deepseek-v4-flash",
  temperature: CLIENT_DEFAULT_TEMPERATURE,
};

// A named API profile lets users keep several providers/models and switch
// between them on the fly.
export interface ApiProfile {
  id: string;
  name: string;
  config: ApiConfig;
}

export interface ProfileStore {
  profiles: ApiProfile[];
  activeId: string;
}

function readStore(): ProfileStore | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as ProfileStore;
    if (!s || !Array.isArray(s.profiles) || s.profiles.length === 0) return null;
    s.profiles = s.profiles.map((p) => ({
      ...p,
      config: { ...DEFAULT_CONFIG, ...p.config },
    }));
    if (!s.profiles.some((p) => p.id === s.activeId)) {
      s.activeId = s.profiles[0].id;
    }
    return s;
  } catch {
    return null;
  }
}

function writeStore(s: ProfileStore) {
  localStorage.setItem(PROFILES_KEY, JSON.stringify(s));
}

// First run (or after upgrading from the single-config build): migrate the old
// stored config into one profile, otherwise seed a default profile.
function migrateOrSeed(): ProfileStore {
  let cfg: ApiConfig = { ...DEFAULT_CONFIG };
  try {
    const legacy = localStorage.getItem(CONFIG_KEY);
    if (legacy) cfg = { ...DEFAULT_CONFIG, ...JSON.parse(legacy) };
  } catch {
    // ignore malformed legacy config
  }
  const id = uid();
  const store: ProfileStore = {
    profiles: [{ id, name: "默认配置", config: cfg }],
    activeId: id,
  };
  writeStore(store);
  return store;
}

export function loadProfiles(): ProfileStore {
  if (typeof window === "undefined") {
    return {
      profiles: [{ id: "default", name: "默认配置", config: { ...DEFAULT_CONFIG } }],
      activeId: "default",
    };
  }
  return readStore() ?? migrateOrSeed();
}

export function saveProfiles(store: ProfileStore) {
  writeStore(store);
}

export function getActiveProfile(): ApiProfile {
  const s = loadProfiles();
  return s.profiles.find((p) => p.id === s.activeId) ?? s.profiles[0];
}

export function setActiveProfile(id: string) {
  const s = loadProfiles();
  if (s.profiles.some((p) => p.id === id)) {
    s.activeId = id;
    writeStore(s);
  }
}

export function addProfile(name: string, config: ApiConfig): ApiProfile {
  const s = loadProfiles();
  const profile: ApiProfile = {
    id: uid(),
    name: name || "新配置",
    config: { ...config },
  };
  s.profiles.push(profile);
  s.activeId = profile.id; // newly added profile becomes active
  writeStore(s);
  return profile;
}

export function updateProfile(
  id: string,
  patch: { name?: string; config?: ApiConfig }
) {
  const s = loadProfiles();
  s.profiles = s.profiles.map((p) =>
    p.id === id
      ? {
          ...p,
          name: patch.name ?? p.name,
          config: patch.config ? { ...p.config, ...patch.config } : p.config,
        }
      : p
  );
  writeStore(s);
}

export function deleteProfile(id: string) {
  const s = loadProfiles();
  s.profiles = s.profiles.filter((p) => p.id !== id);
  if (s.profiles.length === 0) {
    const nid = uid();
    s.profiles = [{ id: nid, name: "默认配置", config: { ...DEFAULT_CONFIG } }];
    s.activeId = nid;
  } else if (!s.profiles.some((p) => p.id === s.activeId)) {
    s.activeId = s.profiles[0].id;
  }
  writeStore(s);
}

// Back-compat: the rest of the app reads/writes "the current config" and stays
// oblivious to profiles — these delegate to the active profile.
export function loadConfig(): ApiConfig {
  if (typeof window === "undefined") return { ...DEFAULT_CONFIG };
  return { ...getActiveProfile().config };
}

export function saveConfig(cfg: ApiConfig) {
  const s = loadProfiles();
  updateProfile(s.activeId, { config: cfg });
}

export function hasConfig(): boolean {
  const c = loadConfig();
  return Boolean(c.baseUrl && c.apiKey && c.model);
}

// ---- project REST helpers ----
export async function fetchProjects(): Promise<ProjectSummary[]> {
  const res = await fetch(apiUrl("/api/projects"), { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function createProject(title: string): Promise<Project> {
  const res = await fetch(apiUrl("/api/projects"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("新建作品失败，请稍后重试。");
  return res.json();
}

export async function fetchProject(id: string): Promise<Project | null> {
  const res = await fetch(apiUrl(`/api/projects/${id}`), { cache: "no-store" });
  if (!res.ok) return null;
  return res.json();
}

export async function saveProjectRemote(project: Project): Promise<Project> {
  const res = await fetch(apiUrl(`/api/projects/${project.id}`), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(project),
  });
  // 失败时回传原对象，避免把错误 JSON 当作作品写回状态。
  if (!res.ok) return project;
  return res.json();
}

export async function deleteProjectRemote(id: string): Promise<void> {
  await fetch(apiUrl(`/api/projects/${id}`), { method: "DELETE" });
}

// ---- studio docs / 确认写入 helpers（P0-1：client 不直连 fs，改走 API）----
export async function fetchDocs(projectId: string): Promise<DocMeta[]> {
  const res = await fetch(apiUrl(`/api/projects/${projectId}/docs`), {
    cache: "no-store",
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { docs?: DocMeta[] };
  return data.docs ?? [];
}

export async function fetchDoc(
  projectId: string,
  name: string
): Promise<DocRecord | null> {
  const res = await fetch(
    apiUrl(`/api/projects/${projectId}/docs?name=${encodeURIComponent(name)}`),
    { cache: "no-store" }
  );
  if (!res.ok) return null;
  const data = (await res.json()) as { doc?: DocRecord };
  return data.doc ?? null;
}

/** FT-09 确认写入闭环：把 .md 提案交给服务端落盘，回传定位结果。失败抛错。 */
export async function confirmMdRemote(
  projectId: string,
  draft: MdDraft
): Promise<ApplyResult> {
  const res = await fetch(apiUrl("/api/studio/confirm-md"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, draft }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    result?: ApplyResult;
    error?: string;
  };
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `落稿失败 (${res.status})`);
  }
  return data.result ?? {};
}

// ---- style card / story archive library helpers ----
export async function fetchStyleCards(): Promise<StyleCard[]> {
  const res = await fetch(apiUrl("/api/styles"), { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function deleteStyleCardRemote(hash: string): Promise<void> {
  await fetch(apiUrl(`/api/styles/${hash}`), { method: "DELETE" });
}

export async function fetchArchives(): Promise<StoryArchive[]> {
  const res = await fetch(apiUrl("/api/archives"), { cache: "no-store" });
  if (!res.ok) return [];
  return res.json();
}

export async function deleteArchiveRemote(hash: string): Promise<void> {
  await fetch(apiUrl(`/api/archives/${hash}`), { method: "DELETE" });
}

/**
 * POST to a streaming endpoint and invoke onChunk with each decoded text
 * fragment as it arrives. Returns the full accumulated text.
 */
export async function streamPost(
  url: string,
  body: unknown,
  onChunk: (fullText: string, delta: string) => void,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(apiUrl(url), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    const msg = await res.text().catch(() => "请求失败");
    throw new Error(msg || `请求失败 (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const delta = decoder.decode(value, { stream: true });
    full += delta;
    onChunk(full, delta);
  }
  return full;
}

// ---- post-regeneration consistency reconciliation ----
// Whether a regeneration should automatically re-align the downstream planning
// artifacts. Defaults to on; persisted per browser.
export function loadReconcilePref(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(RECONCILE_PREF_KEY) !== "0";
}

export function saveReconcilePref(on: boolean) {
  if (typeof window === "undefined") return;
  localStorage.setItem(RECONCILE_PREF_KEY, on ? "1" : "0");
}

/**
 * Ask the server to reconcile downstream artifacts after a regeneration.
 * Returns null on any failure so callers can silently skip reconciliation
 * rather than blocking the user's main action.
 */
export async function requestReconcile(body: {
  config: ApiConfig;
  change: ReconcileChange;
  payload: ReconcilePayload;
  bible: StoryBible | null;
}): Promise<ReconcileResult | null> {
  try {
    const res = await fetch(apiUrl("/api/generate/reconcile"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    return (await res.json()) as ReconcileResult;
  } catch {
    return null;
  }
}

/**
 * Ask the server to (re)compute a rolling recap. Two modes:
 *   volume -> condense one volume's chapter summaries into an arc summary;
 *   book   -> synthesize finished volumes' arcs into a whole-book "story so far".
 * Returns the recap prose, or null on any failure (callers skip silently).
 */
export async function generateRecap(
  body:
    | {
        config: ApiConfig;
        mode: "volume";
        volume: Volume;
        chapterSummaries: RecentSummary[];
        prevArc?: string;
      }
    | {
        config: ApiConfig;
        mode: "book";
        bible: StoryBible;
        priorArcs: { index: number; title: string; arc: string }[];
      }
): Promise<string | null> {
  try {
    const res = await fetch(apiUrl("/api/generate/recap"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { text?: string };
    const text = (data.text || "").trim();
    return text || null;
  } catch {
    return null;
  }
}

export function formatWords(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万字`;
  return `${n} 字`;
}

export function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

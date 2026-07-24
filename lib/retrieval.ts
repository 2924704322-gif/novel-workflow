// Lightweight, deterministic retrieval for long-form continuity.
// No embeddings: for local single-user use, alias/keyword substring matching is
// predictable, fast, and needs no extra model calls. It answers the question
// "which stored facts and open threads matter for THIS chapter?" so we can feed
// the writer a small, relevant slice instead of the whole (unbounded) history.

import type {
  Chapter,
  CodexCategory,
  CodexEntry,
  Foreshadow,
  Project,
  Volume,
} from "./types";
import { CODEX_CATEGORIES } from "./types";

export interface FlatChapter {
  chapter: Chapter;
  volume: Volume;
  prev: Chapter | null;
  global: number; // 1-based reading-order index across the whole book
}

/** Flatten every volume's chapters into a single reading-order list. */
export function flattenChapters(project: Project): FlatChapter[] {
  const out: FlatChapter[] = [];
  let prev: Chapter | null = null;
  let g = 0;
  for (const v of project.volumes) {
    for (const c of v.chapters) {
      g += 1;
      out.push({ chapter: c, volume: v, prev, global: g });
      prev = c;
    }
  }
  return out;
}

/**
 * Rank codex entries by how relevant they are to the chapter being written,
 * blending three signals (inspired by generative-agents retrieval):
 *   - relevance: name/alias appears as a substring of the query text;
 *   - recency:   the entry was updated in a nearby recent chapter;
 *   - importance: characters/factions weigh a little more.
 * Core entries (pinned, or whose name is in `coreNames`, e.g. the bible's main
 * cast) are ALWAYS injected regardless of substring match — this is the single
 * biggest fix for protagonists silently dropping out of context mid-book.
 */
export function selectRelevantCodex(
  codex: CodexEntry[],
  text: string,
  targetGlobal = 0,
  coreNames: string[] = [],
  limit = 14
): CodexEntry[] {
  if (!codex.length) return [];
  const hay = text || "";
  const core = new Set(coreNames.filter(Boolean));
  const always: CodexEntry[] = [];
  const scored: { entry: CodexEntry; score: number }[] = [];
  for (const e of codex) {
    const isCore = Boolean(e.pinned) || core.has(e.name);
    if (isCore) {
      always.push(e);
      continue;
    }
    const keys = [e.name, ...(e.aliases || [])].filter(Boolean);
    let rel = 0;
    for (const k of keys) {
      if (k.length < 1) continue;
      if (hay.includes(k)) rel += k === e.name ? 2 : 1;
    }
    if (rel <= 0) continue;
    let score = rel;
    if (targetGlobal && e.updatedAtChapter) {
      const gap = targetGlobal - e.updatedAtChapter;
      if (gap >= 0 && gap <= 10) score += 2;
      else if (gap > 0 && gap <= 25) score += 1;
    }
    if (e.category === "人物" || e.category === "势力") score += 1;
    scored.push({ entry: e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const room = Math.max(0, limit - always.length);
  return [...always, ...scored.slice(0, room).map((s) => s.entry)];
}

export interface RecentSummary {
  global: number;
  title: string;
  summary: string;
}

/**
 * Collect up to `count` most-recent chapter summaries that precede the target
 * chapter (reading order). These form a rolling "story so far" that keeps
 * continuity beyond just the immediately previous chapter.
 */
export function recentSummaries(
  flat: FlatChapter[],
  targetGlobal: number,
  count = 4
): RecentSummary[] {
  const out: RecentSummary[] = [];
  for (let i = flat.length - 1; i >= 0; i--) {
    const f = flat[i];
    if (f.global >= targetGlobal) continue;
    if (!f.chapter.summary) continue;
    out.push({
      global: f.global,
      title: f.chapter.title,
      summary: f.chapter.summary,
    });
    if (out.length >= count) break;
  }
  return out.reverse();
}

/** Open foreshadows the writer should keep alive (or consider paying off). */
export function activeForeshadows(foreshadows: Foreshadow[]): Foreshadow[] {
  return (foreshadows || []).filter(
    (f) => f.status === "planted" || f.status === "reinforced"
  );
}

export interface ChapterContext {
  codex: CodexEntry[];
  recent: RecentSummary[];
  foreshadows: Foreshadow[];
  storySoFar?: string; // 已完成分卷的全书故事梗概（顶层）
  volumeArc?: string; // 当前卷已完成部分的滚动摘要（中层）
}

/**
 * Assemble everything the chapter writer needs beyond the bible + previous
 * chapter tail. Continuity is delivered in three tiers (RAPTOR-style graduated
 * detail) so mid-book chapters stay anchored without dumping all history:
 *   storySoFar (prior volumes) → volumeArc (this volume) → recent chapter
 * summaries → relevant codex facts + open foreshadows.
 */
export function buildChapterContext(
  project: Project,
  targetChapterId: string
): ChapterContext {
  const flat = flattenChapters(project);
  const target = flat.find((f) => f.chapter.id === targetChapterId);
  const targetGlobal = target?.global ?? flat.length + 1;
  // Keep the most recent ≥5 chapter summaries so continuations (and normal
  // writing) stay anchored to what just happened, not only the previous chapter.
  const recent = recentSummaries(flat, targetGlobal, 5);

  const haystack = [
    target?.chapter.title ?? "",
    target?.chapter.synopsis ?? "",
    ...recent.map((r) => r.summary),
  ].join("\n");

  // Core cast from the bible is always injected so protagonists never drop out.
  const coreNames = (project.bible?.characters || [])
    .map((c) => c.name)
    .filter(Boolean);
  const currentVolume = target?.volume ?? null;

  return {
    codex: selectRelevantCodex(project.codex, haystack, targetGlobal, coreNames, 14),
    recent,
    foreshadows: activeForeshadows(project.foreshadows),
    storySoFar: (project.storySoFar || "").trim() || undefined,
    volumeArc: (currentVolume?.arcSummary || "").trim() || undefined,
  };
}

/**
 * Merge the digest produced after a chapter is written back into the project's
 * codex and foreshadow tables. Matching is by (case-insensitive) name for codex
 * and by title for foreshadows, so repeated updates accumulate instead of
 * duplicating.
 */
export interface ChapterDigest {
  summary?: string;
  codex?: {
    category?: string;
    name?: string;
    aliases?: string[];
    summary?: string;
    status?: string; // 该实体截至本章的存续状态（如 存活/死亡/失踪）
    event?: string; // 本章该实体发生的关键变化（计入状态时间线）
  }[];
  foreshadows?: {
    title?: string;
    detail?: string;
    status?: string;
    payoffPlan?: string;
    action?: "plant" | "reinforce" | "pay" | "abandon";
  }[];
  conflicts?: string[]; // 本章与既有设定/状态的潜在矛盾（仅提示作者，不自动改写）
}

function rid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function normalizeCategory(c?: string): CodexCategory {
  return (CODEX_CATEGORIES as string[]).includes(c || "")
    ? (c as CodexCategory)
    : "其他";
}

/**
 * Fold a chapter digest back into the project: store the chapter summary and
 * merge codex/foreshadow updates. Pure — returns a new Project. Codex entries
 * merge by name; foreshadows merge by title, so repeated passes accumulate
 * instead of duplicating.
 */
export function applyDigest(
  project: Project,
  chapterId: string,
  digest: ChapterDigest
): Project {
  const flat = flattenChapters(project);
  const target = flat.find((f) => f.chapter.id === chapterId);
  const g = target?.global ?? 0;

  // 1) chapter summary
  const volumes = project.volumes.map((v) => ({
    ...v,
    chapters: v.chapters.map((c) =>
      c.id === chapterId && typeof digest.summary === "string" && digest.summary
        ? { ...c, summary: digest.summary }
        : c
    ),
  }));

  // 2) codex merge by name; keep latest summary, append state to timeline
  const codex: CodexEntry[] = project.codex.map((e) => ({ ...e }));
  for (const u of digest.codex || []) {
    const name = (u.name || "").trim();
    if (!name) continue;
    const ev = (u.event || "").trim();
    const status = (u.status || "").trim();
    const existing = codex.find((e) => e.name === name);
    if (existing) {
      if (u.summary) existing.summary = u.summary;
      if (u.category) existing.category = normalizeCategory(u.category);
      if (status) existing.status = status;
      if (u.aliases?.length) {
        existing.aliases = Array.from(
          new Set([...(existing.aliases || []), ...u.aliases])
        );
      }
      if (ev) {
        const events = existing.events ? [...existing.events] : [];
        if (!events.some((x) => x.chapter === g && x.note === ev)) {
          events.push({ chapter: g, note: ev });
        }
        existing.events = events;
      }
      existing.updatedAtChapter = g;
    } else {
      codex.push({
        id: rid(),
        category: normalizeCategory(u.category),
        name,
        aliases: (u.aliases || []).filter(Boolean),
        summary: u.summary || "",
        updatedAtChapter: g,
        status: status || undefined,
        events: ev ? [{ chapter: g, note: ev }] : [],
      });
    }
  }

  // 3) foreshadow merge by title
  const foreshadows: Foreshadow[] = project.foreshadows.map((f) => ({ ...f }));
  for (const u of digest.foreshadows || []) {
    const title = (u.title || "").trim();
    if (!title) continue;
    const action = u.action || "plant";
    const existing = foreshadows.find((f) => f.title === title);
    if (existing) {
      if (u.detail) existing.detail = u.detail;
      if (u.payoffPlan) existing.payoffPlan = u.payoffPlan;
      if (action === "reinforce") existing.status = "reinforced";
      else if (action === "pay") {
        existing.status = "paid";
        existing.paidAt = g;
      } else if (action === "abandon") existing.status = "abandoned";
    } else {
      foreshadows.push({
        id: rid(),
        title,
        detail: u.detail || "",
        status:
          action === "pay"
            ? "paid"
            : action === "abandon"
            ? "abandoned"
            : action === "reinforce"
            ? "reinforced"
            : "planted",
        plantedAt: g,
        payoffPlan: u.payoffPlan || "",
        paidAt: action === "pay" ? g : 0,
      });
    }
  }

  return { ...project, volumes, codex, foreshadows };
}

// ---- Hierarchical rolling summaries (tiered memory, RAPTOR-style) ----

/** All finished-chapter summaries within one volume, in reading order. */
export function volumeChapterDigests(
  project: Project,
  volumeId: string
): RecentSummary[] {
  return flattenChapters(project)
    .filter((f) => f.volume.id === volumeId && f.chapter.summary)
    .map((f) => ({
      global: f.global,
      title: f.chapter.title,
      summary: f.chapter.summary,
    }));
}

/**
 * Arc summaries (fallback: planned summary) of every volume BEFORE the given
 * one — the raw material for the global “story so far” recap.
 */
export function priorVolumeArcs(
  project: Project,
  currentVolumeId: string
): { index: number; title: string; arc: string }[] {
  const out: { index: number; title: string; arc: string }[] = [];
  for (const v of project.volumes) {
    if (v.id === currentVolumeId) break;
    const arc = (v.arcSummary || "").trim() || (v.summary || "").trim();
    if (arc) out.push({ index: v.index, title: v.title, arc });
  }
  return out;
}

/** Write a volume's rolling arc summary. Pure — returns a new Project. */
export function setVolumeArc(
  project: Project,
  volumeId: string,
  arc: string
): Project {
  return {
    ...project,
    volumes: project.volumes.map((v) =>
      v.id === volumeId ? { ...v, arcSummary: arc } : v
    ),
  };
}

/** Write the global “story so far” recap. Pure — returns a new Project. */
export function setStorySoFar(project: Project, text: string): Project {
  return { ...project, storySoFar: text };
}

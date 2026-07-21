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
 * Rank codex entries by how strongly they match the given text (a chapter's
 * title + synopsis, optionally plus recent summaries). An entry matches when its
 * name or any alias appears as a substring; more hits rank higher.
 */
export function selectRelevantCodex(
  codex: CodexEntry[],
  text: string,
  limit = 12
): CodexEntry[] {
  if (!codex.length || !text) return [];
  const hay = text;
  const scored: { entry: CodexEntry; score: number }[] = [];
  for (const e of codex) {
    const keys = [e.name, ...(e.aliases || [])].filter(Boolean);
    let score = 0;
    for (const k of keys) {
      if (k.length < 1) continue;
      if (hay.includes(k)) score += k === e.name ? 2 : 1;
    }
    if (score > 0) scored.push({ entry: e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.entry);
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
}

/**
 * Assemble everything the chapter writer needs beyond the bible + previous
 * chapter tail: relevant codex facts, recent summaries, and open threads.
 */
export function buildChapterContext(
  project: Project,
  targetChapterId: string
): ChapterContext {
  const flat = flattenChapters(project);
  const target = flat.find((f) => f.chapter.id === targetChapterId);
  const targetGlobal = target?.global ?? flat.length + 1;
  const recent = recentSummaries(flat, targetGlobal, 4);

  const haystack = [
    target?.chapter.title ?? "",
    target?.chapter.synopsis ?? "",
    ...recent.map((r) => r.summary),
  ].join("\n");

  return {
    codex: selectRelevantCodex(project.codex, haystack, 12),
    recent,
    foreshadows: activeForeshadows(project.foreshadows),
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
  }[];
  foreshadows?: {
    title?: string;
    detail?: string;
    status?: string;
    payoffPlan?: string;
    action?: "plant" | "reinforce" | "pay" | "abandon";
  }[];
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

  // 2) codex merge by name
  const codex: CodexEntry[] = project.codex.map((e) => ({ ...e }));
  for (const u of digest.codex || []) {
    const name = (u.name || "").trim();
    if (!name) continue;
    const existing = codex.find((e) => e.name === name);
    if (existing) {
      if (u.summary) existing.summary = u.summary;
      if (u.category) existing.category = normalizeCategory(u.category);
      if (u.aliases?.length) {
        existing.aliases = Array.from(
          new Set([...(existing.aliases || []), ...u.aliases])
        );
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

// Post-regeneration consistency reconciliation.
//
// After the user regenerates an upstream artifact (story bible, a chapter's
// outline, or a chapter's prose), the downstream planning artifacts (volume
// summaries, later chapter synopses, cached chapter summaries) may no longer
// line up. This module gathers those downstream artifacts, and — paired with a
// model call (see lib/prompts.buildReconcilePrompt + /api/generate/reconcile) —
// folds the model's targeted edits back in so the whole book stays coherent.
//
// Design notes:
// - We NEVER auto-rewrite already-written prose here: that would silently
//   destroy the author's words. Instead the model reports which chapters' prose
//   may now be stale (`staleProse`) and we merely surface that to the user.
// - Matching is by explicit id (echoed back by the model); unknown ids are
//   ignored, so a malformed reply can't corrupt the project.

import type { Project } from "./types";
import { flattenChapters } from "./retrieval";

// Which artifact was regenerated (drives how the reconcile prompt is framed).
export type ReconcileOrigin = "bible" | "chapter-outline" | "prose";

export interface ReconcileChange {
  origin: ReconcileOrigin;
  label: string; // short human label, e.g. "第12章《旧约》正文已重写"
  detail: string; // the authoritative new text downstream must align with
  direction?: string; // the user's regen direction, if any
}

export interface DownstreamVolume {
  volumeId: string;
  index: number;
  title: string;
  summary: string;
}

export interface DownstreamChapter {
  volumeId: string;
  chapterId: string;
  global: number;
  volumeTitle: string;
  title: string;
  synopsis: string;
  summary: string;
  hasContent: boolean;
}

export interface ReconcilePayload {
  volumes: DownstreamVolume[];
  chapters: DownstreamChapter[];
  truncated: boolean; // true if the candidate chapter list was capped
}

export type ReconcileUpdateKind =
  | "volume-summary"
  | "chapter-synopsis"
  | "chapter-title"
  | "chapter-summary";

export interface ReconcileUpdate {
  kind: ReconcileUpdateKind;
  volumeId?: string;
  chapterId?: string;
  value: string;
}

export interface ReconcileResult {
  changeSummary: string; // author-facing prose describing the change + unification
  updates: ReconcileUpdate[];
  staleProse?: number[]; // global chapter numbers whose written prose may now conflict
}

// Bound the prompt size on very long books: only the nearest downstream
// chapters are sent for reconciliation in one pass.
const MAX_CHAPTERS = 60;

export interface CollectOptions {
  // Only chapters with global >= fromGlobal are candidates (undefined = whole book).
  fromGlobal?: number;
  // Include every volume's summary as a candidate (used for bible-level changes);
  // otherwise only volumes that own a candidate chapter are included.
  includeAllVolumes?: boolean;
  cap?: number;
}

/**
 * Collect the downstream artifacts that a change could have invalidated.
 * Chapters carrying no planning/continuity text at all are skipped (nothing to
 * reconcile). The chapter list is capped to keep the reconcile prompt bounded.
 */
export function collectDownstream(
  project: Project,
  opts: CollectOptions = {}
): ReconcilePayload {
  const { fromGlobal, includeAllVolumes = false, cap = MAX_CHAPTERS } = opts;
  const flat = flattenChapters(project);

  const candidates: DownstreamChapter[] = [];
  for (const f of flat) {
    if (fromGlobal !== undefined && f.global < fromGlobal) continue;
    const c = f.chapter;
    if (!c.synopsis && !c.summary && !c.content) continue;
    candidates.push({
      volumeId: f.volume.id,
      chapterId: c.id,
      global: f.global,
      volumeTitle: f.volume.title,
      title: c.title,
      synopsis: c.synopsis || "",
      summary: c.summary || "",
      hasContent: Boolean(c.content),
    });
  }
  const truncated = candidates.length > cap;
  const chapters = candidates.slice(0, cap);

  const wantVolumeIds = new Set(chapters.map((c) => c.volumeId));
  const volumes: DownstreamVolume[] = project.volumes
    .filter((v) => includeAllVolumes || wantVolumeIds.has(v.id))
    .map((v) => ({
      volumeId: v.id,
      index: v.index,
      title: v.title,
      summary: v.summary || "",
    }));

  return { volumes, chapters, truncated };
}

/** True when a reconcile result actually carries something worth showing. */
export function hasReconcileContent(r: ReconcileResult | null): boolean {
  if (!r) return false;
  return Boolean(
    (r.changeSummary && r.changeSummary.trim()) ||
      (r.updates && r.updates.length) ||
      (r.staleProse && r.staleProse.length)
  );
}

/**
 * Fold the model's reconcile edits back into the project. Pure — returns a new
 * Project. Edits are matched by explicit id and kind; anything that doesn't
 * resolve to a real volume/chapter (or has an empty value) is ignored.
 */
export function applyReconcile(
  project: Project,
  result: ReconcileResult
): Project {
  let volumes = project.volumes;
  for (const u of result.updates || []) {
    const val = (u.value || "").trim();
    if (!val) continue;
    if (u.kind === "volume-summary" && u.volumeId) {
      volumes = volumes.map((v) =>
        v.id === u.volumeId ? { ...v, summary: val } : v
      );
      continue;
    }
    if (!u.chapterId) continue;
    volumes = volumes.map((v) => ({
      ...v,
      chapters: v.chapters.map((c) => {
        if (c.id !== u.chapterId) return c;
        if (u.kind === "chapter-synopsis")
          return { ...c, synopsis: val, updatedAt: Date.now() };
        if (u.kind === "chapter-title")
          return { ...c, title: val, updatedAt: Date.now() };
        if (u.kind === "chapter-summary") return { ...c, summary: val };
        return c;
      }),
    }));
  }
  return volumes === project.volumes ? project : { ...project, volumes };
}

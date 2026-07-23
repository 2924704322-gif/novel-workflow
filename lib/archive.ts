// Utilities for the "拆书学设定" (story archive extractor) feature. It mirrors
// the style analyzer pipeline: chunk → sample → per-chunk model call → merge.
// Chunking/sampling/hashing are reused from lib/style.ts (identical, pure). Here
// we add archive-specific normalization, a deterministic cross-chunk merge, and
// a seed helper that turns an archive into a ready-to-write Project (bible +
// codex) so the user can "二创开新书" from an existing book.

import type {
  ArchiveCharacter,
  ArchiveEntry,
  CodexEntry,
  Project,
  StoryArchive,
  StoryBible,
} from "./types";

// Self-contained id generator (kept here so this module has no dependency on
// the "use client" client.ts and stays safe to import from either side).
function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// The camelCase analysis payload (a StoryArchive without its metadata fields).
export type ArchiveAnalysis = Omit<
  StoryArchive,
  "id" | "sourceFileHash" | "sourceFileName" | "createdAt"
>;

// ---- normalization ---------------------------------------------------------

function s(v: unknown): string {
  return typeof v === "string" ? v.trim() : v == null ? "" : String(v);
}
function arr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(s).filter(Boolean);
}

function normEntries(v: unknown): ArchiveEntry[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => {
      const r = (raw || {}) as Record<string, unknown>;
      return { name: s(r.name), note: s(r.note) };
    })
    .filter((e) => e.name);
}

function normCharacters(v: unknown): ArchiveCharacter[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((raw) => {
      const r = (raw || {}) as Record<string, unknown>;
      return {
        name: s(r.name),
        role: s(r.role),
        aliases: arr(r.aliases),
        profile: s(r.profile),
      };
    })
    .filter((c) => c.name);
}

/** Map one model result (snake_case, possibly partial) to an ArchiveAnalysis. */
export function normalizeArchiveChunk(raw: unknown): ArchiveAnalysis {
  const r = (raw || {}) as Record<string, unknown>;
  return {
    title: s(r.title),
    synopsis: s(r.synopsis),
    worldbuilding: s(r.worldbuilding),
    powerSystem: s(r.power_system),
    themes: s(r.themes),
    styleHint: s(r.style_hint),
    characters: normCharacters(r.characters),
    locations: normEntries(r.locations),
    factions: normEntries(r.factions),
    mainPlot: arr(r.main_plot),
  };
}

// ---- merge -----------------------------------------------------------------

function longest(vals: string[]): string {
  let best = "";
  for (const v of vals) if (v && v.trim().length > best.length) best = v.trim();
  return best;
}
function majority(vals: string[]): string {
  const count = new Map<string, number>();
  for (const v of vals) {
    if (!v) continue;
    count.set(v, (count.get(v) || 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [k, n] of count) if (n > bestN) [best, bestN] = [k, n];
  return best;
}

/** Ordered union of plot points across chunks (chunks are in reading order). */
function mergePlot(lists: string[][], cap = 60): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const list of lists) {
    for (const p of list) {
      const key = p.replace(/\s+/g, "");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(p);
    }
  }
  return out.slice(0, cap);
}

function mergeEntries(lists: ArchiveEntry[][], cap = 24): ArchiveEntry[] {
  const byName = new Map<string, ArchiveEntry>();
  for (const list of lists) {
    for (const e of list) {
      const prev = byName.get(e.name);
      if (!prev) byName.set(e.name, { ...e });
      else if (e.note.length > prev.note.length) prev.note = e.note;
    }
  }
  return [...byName.values()].slice(0, cap);
}

function mergeCharacters(
  lists: ArchiveCharacter[][],
  cap = 40
): ArchiveCharacter[] {
  const byName = new Map<
    string,
    { name: string; roles: string[]; aliases: Set<string>; profile: string }
  >();
  for (const list of lists) {
    for (const c of list) {
      let cur = byName.get(c.name);
      if (!cur) {
        cur = { name: c.name, roles: [], aliases: new Set(), profile: "" };
        byName.set(c.name, cur);
      }
      if (c.role) cur.roles.push(c.role);
      for (const a of c.aliases) cur.aliases.add(a);
      if (c.profile.length > cur.profile.length) cur.profile = c.profile;
    }
  }
  return [...byName.values()].slice(0, cap).map((c) => ({
    name: c.name,
    role: majority(c.roles),
    aliases: [...c.aliases].slice(0, 5),
    profile: c.profile,
  }));
}

/** Fold several per-chunk analyses into one StoryArchive (deterministic). */
export function mergeArchiveChunks(
  chunks: ArchiveAnalysis[],
  meta: { sourceFileHash: string; sourceFileName: string }
): StoryArchive {
  return {
    id: uid(),
    sourceFileHash: meta.sourceFileHash,
    sourceFileName: meta.sourceFileName,
    createdAt: Date.now(),
    title:
      majority(chunks.map((c) => c.title)) ||
      longest(chunks.map((c) => c.title)) ||
      "未命名作品",
    synopsis: longest(chunks.map((c) => c.synopsis)),
    worldbuilding: longest(chunks.map((c) => c.worldbuilding)),
    powerSystem: longest(chunks.map((c) => c.powerSystem)),
    themes: longest(chunks.map((c) => c.themes)),
    styleHint: longest(chunks.map((c) => c.styleHint)),
    characters: mergeCharacters(chunks.map((c) => c.characters)),
    locations: mergeEntries(chunks.map((c) => c.locations)),
    factions: mergeEntries(chunks.map((c) => c.factions)),
    mainPlot: mergePlot(chunks.map((c) => c.mainPlot)),
  };
}

// ---- reduce (whole-book synthesis) -----------------------------------------

/** Dedupe fragments (by trimmed text) and cap the count. */
function dedupeCap(vals: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of vals) {
    const t = v.trim();
    if (!t || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * Compile all per-chunk analyses into a compact text block for the reduce
 * prompt: ordered per-chunk synopses + deduped worldbuilding / power / theme /
 * style fragments + the full ordered plot list. The model then synthesizes a
 * whole-book view and condenses the plot.
 */
export function buildReduceMaterial(chunks: ArchiveAnalysis[]): string {
  const syn = chunks.map((c) => c.synopsis.trim()).filter(Boolean);
  const world = dedupeCap(chunks.map((c) => c.worldbuilding), 24);
  const power = dedupeCap(chunks.map((c) => c.powerSystem), 16);
  const themes = dedupeCap(chunks.map((c) => c.themes), 16);
  const style = dedupeCap(chunks.map((c) => c.styleHint), 12);
  const plot = mergePlot(chunks.map((c) => c.mainPlot), 120);

  const sections: string[] = [];
  if (syn.length)
    sections.push(
      "【各段剧情概述（按阅读顺序）】\n" +
        syn.map((v, i) => `${i + 1}. ${v}`).join("\n")
    );
  if (world.length)
    sections.push("【世界观设定片段】\n" + world.map((v) => `- ${v}`).join("\n"));
  if (power.length)
    sections.push(
      "【力量体系 / 世界规则片段】\n" + power.map((v) => `- ${v}`).join("\n")
    );
  if (themes.length)
    sections.push(
      "【主题与基调片段】\n" + themes.map((v) => `- ${v}`).join("\n")
    );
  if (style.length)
    sections.push("【文风提示片段】\n" + style.map((v) => `- ${v}`).join("\n"));
  if (plot.length)
    sections.push(
      "【全书主线事件（按时序，可能零散重复）】\n" +
        plot.map((v, i) => `${i + 1}. ${v}`).join("\n")
    );
  return sections.join("\n\n");
}

/**
 * Overlay a reduce result onto the deterministic merge. Only non-empty reduced
 * fields replace the merged ones, so a failed / partial reduce never wipes data.
 * Characters / locations / factions stay from the deterministic merge (they are
 * union-merged, not summarized).
 */
export function applyArchiveReduce(
  archive: StoryArchive,
  raw: unknown
): StoryArchive {
  const r = (raw || {}) as Record<string, unknown>;
  const plot = arr(r.main_plot);
  return {
    ...archive,
    synopsis: s(r.synopsis) || archive.synopsis,
    worldbuilding: s(r.worldbuilding) || archive.worldbuilding,
    powerSystem: s(r.power_system) || archive.powerSystem,
    themes: s(r.themes) || archive.themes,
    styleHint: s(r.style_hint) || archive.styleHint,
    mainPlot: plot.length ? plot.slice(0, 20) : archive.mainPlot,
  };
}

// ---- shared archive → bible / codex mappers --------------------------------

/** Build a StoryBible from an archive (used by both 二创 and 续写 seeding). */
export function archiveBible(archive: StoryArchive): StoryBible {
  const worldParts = [
    archive.worldbuilding,
    archive.powerSystem ? `【力量体系 / 世界规则】\n${archive.powerSystem}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    logline: archive.synopsis.split(/[。！？\n]/).filter(Boolean)[0] || "",
    synopsis: archive.synopsis,
    worldbuilding: worldParts,
    themes: archive.themes,
    tone: archive.styleHint,
    characters: archive.characters.map((c) => ({
      name: c.name,
      role: c.role,
      profile: c.profile,
    })),
  };
}

/** Build codex entries (characters / locations / factions / settings) from an archive. */
export function archiveCodex(archive: StoryArchive): CodexEntry[] {
  const codex: CodexEntry[] = [];
  for (const c of archive.characters) {
    codex.push({
      id: uid(),
      category: "人物",
      name: c.name,
      aliases: c.aliases,
      summary: [c.role, c.profile].filter(Boolean).join("｜"),
      updatedAtChapter: 0,
    });
  }
  for (const l of archive.locations) {
    codex.push({
      id: uid(),
      category: "地点",
      name: l.name,
      aliases: [],
      summary: l.note,
      updatedAtChapter: 0,
    });
  }
  for (const f of archive.factions) {
    codex.push({
      id: uid(),
      category: "势力",
      name: f.name,
      aliases: [],
      summary: f.note,
      updatedAtChapter: 0,
    });
  }
  if (archive.powerSystem) {
    codex.push({
      id: uid(),
      category: "设定",
      name: "力量体系 / 世界规则",
      aliases: [],
      summary: archive.powerSystem,
      updatedAtChapter: 0,
    });
  }
  if (archive.mainPlot.length) {
    codex.push({
      id: uid(),
      category: "设定",
      name: "原作主线剧情（参考）",
      aliases: [],
      summary: archive.mainPlot.map((p, i) => `${i + 1}. ${p}`).join("\n"),
      updatedAtChapter: 0,
    });
  }
  return codex;
}

/**
 * Continuation seeding: unlike 二创 (which diverges into a new plot), a 续写
 * imports an existing book's setting to keep writing the SAME story. Returns the
 * bible + codex derived from the archive; the caller keeps the parsed volumes.
 */
export function archiveToContinuation(archive: StoryArchive): {
  bible: StoryBible;
  codex: CodexEntry[];
} {
  return { bible: archiveBible(archive), codex: archiveCodex(archive) };
}

// ---- seed a new project from an archive ------------------------------------

/**
 * Fold an archive into a Project (bible + codex + light setup) so the user can
 * start a derivative work. The original synopsis/plot are kept as reference
 * material (bible.synopsis + a codex "设定" entry), not forced as the new plot —
 * the outline step lets the user regenerate or edit freely.
 */
export function seedProjectFromArchive(
  project: Project,
  archive: StoryArchive
): Project {
  const firstLead =
    archive.characters.find((c) => /主角|主人公|男主|女主/.test(c.role)) ||
    archive.characters[0];

  const keepTitle = project.title && project.title !== "未命名作品";

  return {
    ...project,
    title: keepTitle ? project.title : `${archive.title}·二创`,
    phase: "outline",
    setup: {
      ...project.setup,
      premise: `二创设定来源：《${archive.title}》。${archive.synopsis.slice(0, 120)}`,
      protagonist: firstLead
        ? `${firstLead.name}（${firstLead.role}）：${firstLead.profile}`
        : project.setup.protagonist,
      style: archive.styleHint || project.setup.style,
      extra:
        "本作为二次创作：请沿用来源世界观、力量体系与既有人物设定，但发展全新的主线剧情，避免照抄原作情节。",
    },
    bible: archiveBible(archive),
    volumes: [],
    codex: archiveCodex(archive),
    foreshadows: [],
  };
}

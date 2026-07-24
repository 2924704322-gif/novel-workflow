import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_SETUP, type Project, type StyleCard, type StoryArchive } from "./types";

// Projects persist as one JSON file each under <root>/projects/.
// This keeps a novel's data durable across restarts for local use.
// The root defaults to <cwd>/data for `next dev`/`next start`, but the
// packaged desktop app (Electron) sets NOVEL_DATA_ROOT to a user-writable
// directory because the install dir is typically read-only.
const ROOT = process.env.NOVEL_DATA_ROOT || path.join(process.cwd(), "data");
const DATA_DIR = path.join(ROOT, "projects");
// Style cards (拆书学文风) cache under <root>/styles/, keyed by source file hash.
const STYLE_DIR = path.join(ROOT, "styles");
// Story archives (拆书学设定) cache under <root>/archives/, keyed by source file hash.
const ARCHIVE_DIR = path.join(ROOT, "archives");

// 数据根目录（供其它持久化模块复用，如 Agent 会话 / 待确认提案存储）。
// 单一真源：与 projects/styles/archives 落在同一 root 下，桌面版沿用 NOVEL_DATA_ROOT。
export function dataRoot(): string {
  return ROOT;
}

// Backfill fields added in later versions so projects saved by older builds
// keep working without a manual migration step.
function normalizeProject(p: Project): Project {
  p.setup = { ...DEFAULT_SETUP, ...(p.setup || {}) };
  if (!Array.isArray(p.codex)) p.codex = [];
  if (!Array.isArray(p.foreshadows)) p.foreshadows = [];
  // 旧项目/损坏文件可能缺少这些数组字段；补齐以免下游
  // projectStats / flattenChapters 直接遍历时崩溃白屏。
  if (!Array.isArray(p.volumes)) p.volumes = [];
  if (!Array.isArray(p.prompts)) p.prompts = [];
  if (typeof p.storySoFar !== "string") p.storySoFar = "";
  // 设定库新增的状态时间线字段：旧条目回填空事件数组，避免遍历时报错。
  for (const e of p.codex) {
    if (!Array.isArray(e.events)) e.events = [];
  }
  for (const v of p.volumes) {
    if (!Array.isArray(v.chapters)) v.chapters = [];
    if (typeof v.arcSummary !== "string") v.arcSummary = "";
    for (const c of v.chapters) {
      if (typeof c.summary !== "string") c.summary = "";
    }
  }
  return p;
}

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

function fileFor(id: string) {
  // guard against path traversal in ids
  const safe = id.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(DATA_DIR, `${safe}.json`);
}

export async function listProjects(): Promise<Project[]> {
  await ensureDir();
  const files = await fs.readdir(DATA_DIR);
  const projects: Project[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(DATA_DIR, f), "utf-8");
      projects.push(normalizeProject(JSON.parse(raw) as Project));
    } catch {
      // skip unreadable/corrupt files
    }
  }
  projects.sort((a, b) => b.updatedAt - a.updatedAt);
  return projects;
}

export async function getProject(id: string): Promise<Project | null> {
  await ensureDir();
  try {
    const raw = await fs.readFile(fileFor(id), "utf-8");
    return normalizeProject(JSON.parse(raw) as Project);
  } catch {
    return null;
  }
}

export async function saveProject(project: Project): Promise<Project> {
  await ensureDir();
  project.updatedAt = Date.now();
  await fs.writeFile(fileFor(project.id), JSON.stringify(project, null, 2), "utf-8");
  return project;
}

export async function deleteProject(id: string): Promise<void> {
  await ensureDir();
  try {
    await fs.unlink(fileFor(id));
  } catch {
    // already gone
  }
}

// ---- style card cache ------------------------------------------------------

function styleFileFor(hash: string) {
  const safe = hash.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(STYLE_DIR, `${safe}.json`);
}

/** Return a cached style card by source-file hash, or null on miss. */
export async function getStyleCard(hash: string): Promise<StyleCard | null> {
  try {
    const raw = await fs.readFile(styleFileFor(hash), "utf-8");
    return JSON.parse(raw) as StyleCard;
  } catch {
    return null;
  }
}

/** Persist a style card, keyed by its sourceFileHash. */
export async function saveStyleCard(card: StyleCard): Promise<StyleCard> {
  await fs.mkdir(STYLE_DIR, { recursive: true });
  await fs.writeFile(
    styleFileFor(card.sourceFileHash),
    JSON.stringify(card, null, 2),
    "utf-8"
  );
  return card;
}

/** List all saved style cards, newest first. */
export async function listStyleCards(): Promise<StyleCard[]> {
  await fs.mkdir(STYLE_DIR, { recursive: true });
  const files = await fs.readdir(STYLE_DIR);
  const cards: StyleCard[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(STYLE_DIR, f), "utf-8");
      cards.push(JSON.parse(raw) as StyleCard);
    } catch {
      // skip unreadable/corrupt files
    }
  }
  cards.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return cards;
}

/** Delete a saved style card by source-file hash. */
export async function deleteStyleCard(hash: string): Promise<void> {
  try {
    await fs.unlink(styleFileFor(hash));
  } catch {
    // already gone
  }
}

// ---- story archive cache ---------------------------------------------------

function archiveFileFor(hash: string) {
  const safe = hash.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(ARCHIVE_DIR, `${safe}.json`);
}

/** Return a cached story archive by source-file hash, or null on miss. */
export async function getArchive(hash: string): Promise<StoryArchive | null> {
  try {
    const raw = await fs.readFile(archiveFileFor(hash), "utf-8");
    return JSON.parse(raw) as StoryArchive;
  } catch {
    return null;
  }
}

/** Persist a story archive, keyed by its sourceFileHash. */
export async function saveArchive(archive: StoryArchive): Promise<StoryArchive> {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  await fs.writeFile(
    archiveFileFor(archive.sourceFileHash),
    JSON.stringify(archive, null, 2),
    "utf-8"
  );
  return archive;
}

/** List all saved story archives, newest first. */
export async function listArchives(): Promise<StoryArchive[]> {
  await fs.mkdir(ARCHIVE_DIR, { recursive: true });
  const files = await fs.readdir(ARCHIVE_DIR);
  const archives: StoryArchive[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(ARCHIVE_DIR, f), "utf-8");
      archives.push(JSON.parse(raw) as StoryArchive);
    } catch {
      // skip unreadable/corrupt files
    }
  }
  archives.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return archives;
}

/** Delete a saved story archive by source-file hash. */
export async function deleteArchive(hash: string): Promise<void> {
  try {
    await fs.unlink(archiveFileFor(hash));
  } catch {
    // already gone
  }
}

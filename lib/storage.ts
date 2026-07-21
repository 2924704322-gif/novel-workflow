import { promises as fs } from "fs";
import path from "path";
import { DEFAULT_SETUP, type Project } from "./types";

// Projects persist as one JSON file each under data/projects/.
// This keeps a novel's data durable across restarts for local use.
const DATA_DIR = path.join(process.cwd(), "data", "projects");

// Backfill fields added in later versions so projects saved by older builds
// keep working without a manual migration step.
function normalizeProject(p: Project): Project {
  p.setup = { ...DEFAULT_SETUP, ...(p.setup || {}) };
  if (!Array.isArray(p.codex)) p.codex = [];
  if (!Array.isArray(p.foreshadows)) p.foreshadows = [];
  for (const v of p.volumes || []) {
    for (const c of v.chapters || []) {
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

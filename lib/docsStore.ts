// .md 文档存储层（docsStore）—— 设定类事实源（FT-07）
//
// 落点：data/projects/<id>/docs/<name>.md
// 文档命名约定：<种类>_<书名>.md（如 世界观.md / 人物设定_沈寄.md / 大纲_卷一.md）。
// front-matter 仅要求 kind 必填（world/character/outline/inspiration/other）。
//
// 设计要点：
//   - 复用 lib/storage.ts 的 dataRoot()，与 projects/styles/archives 同根（桌面版沿用 NOVEL_DATA_ROOT）。
//   - 防穿越：文档名只作单文件名，拒绝分隔符与 ".."；再用 path.resolve + 基目录包含校验
//     做兜底（GitHub 取经结论：resolve+startsWith(base+sep) 才是权威防线，
//     且能保留 世界观.md 这类中文名，而正则剥离会误删中文）。
//   - 不引第三方 YAML 依赖：自研极简 front-matter 子集解析（字符串/数字/布尔，支持引号）。

import { promises as fs } from "fs";
import path from "path";
import { dataRoot } from "./storage";
import { countWords } from "./types";

export type DocKind = "world" | "character" | "outline" | "inspiration" | "other";

export interface DocMeta {
  /** 文件名，如 世界观.md */
  name: string;
  kind: DocKind;
  /** 展示用中文标签：世界观 / 人物 / 大纲 / 灵感 / 其他 */
  kindLabel: string;
  words: number;
  updatedAt: number;
}

export interface DocRecord extends DocMeta {
  /** markdown 全文（不含 front-matter） */
  body: string;
}

export interface DocsStore {
  list(projectId: string): Promise<DocMeta[]>;
  read(projectId: string, name: string): Promise<DocRecord | null>;
  save(projectId: string, name: string, body: string, kind: DocKind): Promise<DocRecord>;
  remove(projectId: string, name: string): Promise<void>;
}

const KIND_LABEL: Record<DocKind, string> = {
  world: "世界观",
  character: "人物",
  outline: "大纲",
  inspiration: "灵感",
  other: "其他",
};

const KINDS: DocKind[] = ["world", "character", "outline", "inspiration", "other"];

// ---- 路径安全 ---------------------------------------------------------------

/** 项目 id 仅允许安全字符（与 storage.ts 的 fileFor 保持一致）。 */
function safeProjectId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

function docsDirFor(projectId: string): string {
  return path.join(dataRoot(), "projects", safeProjectId(projectId), "docs");
}

/**
 * 将文档名解析为 docs 目录内的绝对路径，并做路径穿越防护。
 * 文档名可含中文（如 世界观.md），因此不采用正则剥离，而是：
 *   1) 拒绝 null 字节、路径分隔符、以及任何 ".." 片段（防御纵深）；
 *   2) path.resolve 后校验结果仍位于基目录内（权威兜底）。
 */
function safeDocPath(dir: string, name: string): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("invalid doc name");
  }
  if (name.includes("\0")) throw new Error("invalid doc name");
  if (name.includes("/") || name.includes("\\")) {
    throw new Error("path separator not allowed in doc name");
  }
  if (name === ".." || name.startsWith("..") || name.includes("..")) {
    throw new Error("path traversal detected");
  }
  const base = path.resolve(dir);
  const target = path.resolve(base, name);
  if (target !== base && !target.startsWith(base + path.sep)) {
    throw new Error("path traversal detected");
  }
  return target;
}

// ---- 极简 front-matter（YAML 子集）-----------------------------------------

type FrontMatter = Record<string, string | number | boolean>;

function parseFrontMatter(raw: string): { fm: FrontMatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!match) return { fm: {}, body: raw };
  const fmText = match[1];
  const body = match[2];
  const fm: FrontMatter = {};
  for (const line of fmText.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let val = line.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (val === "true") fm[key] = true;
    else if (val === "false") fm[key] = false;
    else if (val !== "" && !Number.isNaN(Number(val))) fm[key] = Number(val);
    else fm[key] = val;
  }
  return { fm, body };
}

function serializeFrontMatter(fm: FrontMatter): string {
  const lines = Object.entries(fm)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}: ${String(v)}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

function normalizeKind(value: unknown): DocKind {
  return (KINDS as string[]).includes(value as string) ? (value as DocKind) : "other";
}

// ---- 存储实现 ---------------------------------------------------------------

async function listDocs(projectId: string): Promise<DocMeta[]> {
  const dir = docsDirFor(projectId);
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const metas: DocMeta[] = [];
  for (const f of files) {
    if (!f.endsWith(".md")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, f), "utf-8");
      const { fm, body } = parseFrontMatter(raw);
      const kind = normalizeKind(fm.kind);
      const stat = await fs.stat(path.join(dir, f));
      metas.push({
        name: f,
        kind,
        kindLabel: KIND_LABEL[kind],
        words: countWords(body),
        updatedAt: stat.mtimeMs,
      });
    } catch {
      // 跳过损坏/不可读文件
    }
  }
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  return metas;
}

async function readDoc(projectId: string, name: string): Promise<DocRecord | null> {
  const dir = docsDirFor(projectId);
  const file = safeDocPath(dir, name);
  try {
    const raw = await fs.readFile(file, "utf-8");
    const { fm, body } = parseFrontMatter(raw);
    const kind = normalizeKind(fm.kind);
    const stat = await fs.stat(file);
    return {
      name,
      kind,
      kindLabel: KIND_LABEL[kind],
      words: countWords(body),
      updatedAt: stat.mtimeMs,
      body,
    };
  } catch {
    return null;
  }
}

async function saveDoc(
  projectId: string,
  name: string,
  body: string,
  kind: DocKind
): Promise<DocRecord> {
  const dir = docsDirFor(projectId);
  await fs.mkdir(dir, { recursive: true });
  const file = safeDocPath(dir, name);
  const fm = serializeFrontMatter({ kind });
  // P2-2：原子写入——先落临时文件再 rename，避免写盘中断产生半截 .md。
  const tmp = `${file}.${Date.now().toString(36)}.tmp`;
  await fs.writeFile(tmp, fm + body, "utf-8");
  await fs.rename(tmp, file);
  return {
    name,
    kind,
    kindLabel: KIND_LABEL[kind],
    words: countWords(body),
    updatedAt: Date.now(),
    body,
  };
}

async function removeDoc(projectId: string, name: string): Promise<void> {
  const dir = docsDirFor(projectId);
  const file = safeDocPath(dir, name);
  try {
    await fs.unlink(file);
  } catch {
    // 文件已不存在，幂等
  }
}

/** 默认文件系统实现单例。 */
export const docsStore: DocsStore = {
  list: listDocs,
  read: readDoc,
  save: saveDoc,
  remove: removeDoc,
};

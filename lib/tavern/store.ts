// 酒馆存储层（tavernStore）—— 酒馆运行时注入层（FT-15）
//
// 落点：data/tavern/{characters,lorebooks,groups,presets}/<id>.json
// 复用 lib/storage.ts 的 dataRoot() + safeId/ownerId 隔离模式。
//
// 安全设计（GitHub 取经）：
//   - 路径穿越防护采用「分段净化（防御纵深）+ path.resolve 基目录包含校验（权威兜底）」，
//     既挡住 "../" 穿越，又保留中文 id 作为文件名的可能性。
//   - ownerId 过滤：lorebook/group 的 novelchat.ownerId 必填；角色卡经 extensions.novelchat.ownerId
//     过滤（见 types.ts 的扩展说明），拒绝越权读取他人酒馆资产。
//
// 接口契约以终稿 §3.3 的 TavernStore 为准；remove* 为 CRUD 完整性/测试补充方法，
// 不影响契约（TavernStore 为其子集）。presets 落点预留给 FT-22 预设管理器。

import { promises as fs } from "fs";
import path from "path";
import { dataRoot } from "../storage";
import type { CharacterCardV2, Lorebook, RoleplayGroup, TavernPreset } from "./types";

const TAVERN_DIR = path.join(dataRoot(), "tavern");
const CHARACTERS_DIR = path.join(TAVERN_DIR, "characters");
const LOREBOOKS_DIR = path.join(TAVERN_DIR, "lorebooks");
const GROUPS_DIR = path.join(TAVERN_DIR, "groups");
const PRESETS_DIR = path.join(TAVERN_DIR, "presets"); // 预留：FT-22 预设管理器

export interface CardMeta {
  codexId: string;
  name: string;
  updatedAt: number;
}

/** 终稿 §3.3 契约。 */
export interface TavernStore {
  listCharacters(ownerId: string): Promise<CardMeta[]>;
  readCharacter(codexId: string): Promise<CharacterCardV2 | null>;
  saveCharacter(card: CharacterCardV2): Promise<void>;
  listLorebooks(ownerId: string, projectId?: string): Promise<Lorebook[]>;
  readLorebook(id: string): Promise<Lorebook | null>;
  saveLorebook(book: Lorebook): Promise<void>;
  listGroups(ownerId: string, projectId: string): Promise<RoleplayGroup[]>;
  saveGroup(g: RoleplayGroup): Promise<void>;
}

/** 在 §3.3 契约上扩展 remove*，供 CRUD/测试使用（不破坏契约）。 */
export interface TavernStoreExtended extends TavernStore {
  removeCharacter(codexId: string): Promise<void>;
  removeLorebook(id: string): Promise<void>;
  removeGroup(id: string): Promise<void>;
  // FT-20：显式读取单本世界书（FT-19 runGroupTurn 经此加载 req.lorebookIds 指定书）
  readLorebook(id: string): Promise<Lorebook | null>;
  // P1-3：读取单个群组（DELETE 路由归属校验用）
  readGroup(id: string): Promise<RoleplayGroup | null>;
  // 预设（FT-22 用，FT-20 先建骨架）
  listPresets(ownerId: string, projectId?: string): Promise<TavernPreset[]>;
  savePreset(preset: TavernPreset): Promise<void>;
  readPreset(id: string): Promise<TavernPreset | null>;
  removePreset(id: string): Promise<void>;
}

// ---- 路径安全 ---------------------------------------------------------------

/**
 * 净化单段文件名（不含扩展名）：拒绝 null 字节、路径分隔符与任何 ".." 片段。
 * 仅作防御纵深；真正的兜底见 safeFile 的 resolve+包含校验。
 */
function safeSegment(name: string): string {
  if (typeof name !== "string" || name.length === 0) {
    throw new Error("invalid id");
  }
  if (name.includes("\0")) throw new Error("invalid id");
  if (name.includes("/") || name.includes("\\")) {
    throw new Error("path separator not allowed");
  }
  if (name === ".." || name.startsWith("..") || name.includes("..")) {
    throw new Error("path traversal detected");
  }
  return name;
}

/** 将 <id>.json 解析为基目录内的绝对路径，并校验不逃逸基目录。 */
function safeFile(base: string, id: string): string {
  const seg = safeSegment(id);
  const dir = path.resolve(base);
  const target = path.resolve(dir, `${seg}.json`);
  if (target !== dir && !target.startsWith(dir + path.sep)) {
    throw new Error("path traversal detected");
  }
  return target;
}

// ---- 通用 JSON 读写 ----------------------------------------------------------

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await fs.readFile(file, "utf-8")) as T;
  } catch {
    return null;
  }
}

async function writeJson(file: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  // P2-2：原子写入——先落临时文件再 rename，避免写盘中断产生半截 JSON。
  const tmp = `${file}.${Date.now().toString(36)}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  await fs.rename(tmp, file);
}

async function listJson<T>(dir: string): Promise<T[]> {
  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: T[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    const item = await readJson<T>(path.join(dir, f));
    if (item) out.push(item);
  }
  return out;
}

// ---- 角色卡（characters）----------------------------------------------------

async function listCharacters(ownerId: string): Promise<CardMeta[]> {
  const cards = await listJson<CharacterCardV2>(CHARACTERS_DIR);
  const metas: CardMeta[] = [];
  for (const c of cards) {
    const nc = c.extensions?.novelchat;
    if (!nc || nc.ownerId !== ownerId) continue; // ownerId 过滤防越权
    const codexId = nc.codexId;
    if (!codexId) continue;
    let updatedAt = 0;
    try {
      updatedAt = (await fs.stat(safeFile(CHARACTERS_DIR, codexId))).mtimeMs;
    } catch {
      // 文件名与 codexId 不一致时退化为 0，不影响列表
    }
    metas.push({ codexId, name: c.data?.name ?? codexId, updatedAt });
  }
  metas.sort((a, b) => b.updatedAt - a.updatedAt);
  return metas;
}

async function readCharacter(codexId: string): Promise<CharacterCardV2 | null> {
  return readJson<CharacterCardV2>(safeFile(CHARACTERS_DIR, codexId));
}

async function saveCharacter(card: CharacterCardV2): Promise<void> {
  const codexId = card.extensions?.novelchat?.codexId;
  if (!codexId) {
    throw new Error("character card missing extensions.novelchat.codexId");
  }
  // 默认补全 spec/extensions，并保留 V2 规范要求的未知键（不破坏 extensions 其它命名空间）。
  const merged: CharacterCardV2 = {
    spec: "chara_card_v2",
    spec_version: "2.0",
    data: card.data,
    extensions: {
      ...(card.extensions || {}),
      novelchat: { ...(card.extensions?.novelchat || {}), codexId },
    },
  };
  await writeJson(safeFile(CHARACTERS_DIR, codexId), merged);
}

async function removeCharacter(codexId: string): Promise<void> {
  try {
    await fs.unlink(safeFile(CHARACTERS_DIR, codexId));
  } catch {
    // 幂等
  }
}

// ---- 世界书（lorebooks）-----------------------------------------------------

async function listLorebooks(ownerId: string, projectId?: string): Promise<Lorebook[]> {
  const books = await listJson<Lorebook>(LOREBOOKS_DIR);
  return books.filter(
    (b) =>
      b.novelchat?.ownerId === ownerId &&
      (projectId === undefined || b.novelchat.projectId === projectId)
  );
}

async function saveLorebook(book: Lorebook): Promise<void> {
  if (!book.id) throw new Error("lorebook missing id");
  await writeJson(safeFile(LOREBOOKS_DIR, book.id), book);
}

/** 读取单本世界书（按 id）；不存在返回 null。 */
async function readLorebook(id: string): Promise<Lorebook | null> {
  return readJson<Lorebook>(safeFile(LOREBOOKS_DIR, id));
}

async function removeLorebook(id: string): Promise<void> {
  try {
    await fs.unlink(safeFile(LOREBOOKS_DIR, id));
  } catch {
    // 幂等
  }
}

// ---- 群组（groups）---------------------------------------------------------

async function listGroups(ownerId: string, projectId: string): Promise<RoleplayGroup[]> {
  const groups = await listJson<RoleplayGroup>(GROUPS_DIR);
  return groups.filter(
    (g) => g.novelchat?.ownerId === ownerId && g.novelchat.projectId === projectId
  );
}

async function saveGroup(g: RoleplayGroup): Promise<void> {
  if (!g.id) throw new Error("group missing id");
  await writeJson(safeFile(GROUPS_DIR, g.id), g);
}

/** 读取单个群组（按 id）；不存在返回 null。 */
async function readGroup(id: string): Promise<RoleplayGroup | null> {
  return readJson<RoleplayGroup>(safeFile(GROUPS_DIR, id));
}

async function removeGroup(id: string): Promise<void> {
  try {
    await fs.unlink(safeFile(GROUPS_DIR, id));
  } catch {
    // 幂等
  }
}

// ---- 预设（presets，FT-20 骨架 / FT-22 用）--------------------------------

async function listPresets(ownerId: string, projectId?: string): Promise<TavernPreset[]> {
  const presets = await listJson<TavernPreset>(PRESETS_DIR);
  return presets.filter(
    (p) => p.novelchat?.ownerId === ownerId && (projectId === undefined || p.novelchat.projectId === projectId)
  );
}

async function savePreset(preset: TavernPreset): Promise<void> {
  if (!preset.id) throw new Error("preset missing id");
  await writeJson(safeFile(PRESETS_DIR, preset.id), preset);
}

async function readPreset(id: string): Promise<TavernPreset | null> {
  return readJson<TavernPreset>(safeFile(PRESETS_DIR, id));
}

async function removePreset(id: string): Promise<void> {
  try {
    await fs.unlink(safeFile(PRESETS_DIR, id));
  } catch {
    // 幂等
  }
}

// 确保各子目录存在（presets 落点预留，供 FT-22 使用）。
async function ensureTavernDirs(): Promise<void> {
  await fs.mkdir(PRESETS_DIR, { recursive: true });
}

// 模块加载时确保目录存在（幂等）。
void ensureTavernDirs();

class TavernFileSystemStore implements TavernStoreExtended {
  listCharacters = listCharacters;
  readCharacter = readCharacter;
  saveCharacter = saveCharacter;
  listLorebooks = listLorebooks;
  readLorebook = readLorebook;
  saveLorebook = saveLorebook;
  listGroups = listGroups;
  saveGroup = saveGroup;
  readGroup = readGroup;
  removeCharacter = removeCharacter;
  removeLorebook = removeLorebook;
  removeGroup = removeGroup;
  listPresets = listPresets;
  savePreset = savePreset;
  readPreset = readPreset;
  removePreset = removePreset;
}

/** 默认文件系统实现单例。 */
export const tavernStore: TavernStoreExtended = new TavernFileSystemStore();

// 单向同步缝（FT-23，Q5 单向 `.md` → 酒馆）
//
// 职责：
//   - syncDocsToTavern(project, ownerId)：把项目的全部 .md 文档单向推入酒馆运行时
//     —— 世界观类（kind==="world"）写入「项目级世界书」(world-<projectId>) 的 entries；
//     人物类（kind==="character"，命名 人物设定_<name>.md）经 codexId 链接写入角色卡
//     data.description。幂等。
//   - syncDocToTavern(project, ownerId, docName)：同步单篇文档（供 FT-22 的「.md 同步」按钮）。
//
// 关键约束：
//   - Q5 单向：`.md` 是【唯一可编辑事实源】。本模块只【读】.md、【写】酒馆，绝不回写 .md
//     （不调用 docsStore.save/remove），绝不回写 Project.codex（Q4）。
//   - Q4 三方共存：通过 extensions.novelchat.codexId 关联 codex↔角色卡；本模块只读 codex
//     取「人物名 → 文档名」映射，从不 mutable 改 codex。
//   - 幂等：世界书 entry 按 novelchat.sourceDoc 匹配；角色卡按 codexId 匹配；重跑不产生
//     重复条目/卡片，人工维护字段（keys/order/enabled/...）永不被覆盖。
//
// 项目级世界书 id 约定（FT-23 新定）：`world-${project.id}`，
// novelchat = { ownerId, projectId, kind: "project" }。

import { docsStore, type DocRecord } from "../docsStore";
import { tavernStore } from "./store";
import type { Lorebook, LorebookEntry } from "./types";
import { loadCharacter, saveCharacter } from "../roleplay/characterCard";
import type { Project } from "../types";

/** 同步结果（供 UI/调用方汇报）。 */
export interface SyncResult {
  /** 同步进世界书 entries 的世界类 .md 数量 */
  worldDocs: number;
  /** 同步进角色卡的人物类 .md 数量 */
  characterDocs: number;
  /** 无可同步酒馆目标的文档数（outline/inspiration/other，见 Q5 说明） */
  skipped: number;
  /** 本次使用的项目级世界书 id（world-<projectId>） */
  worldLorebookId: string;
}

/** 项目级世界书 id 约定。 */
function worldLorebookIdFor(projectId: string): string {
  return `world-${projectId}`;
}

/**
 * 由文档名派生稳定的世界书 entry id（仅用于新书内唯一性；匹配靠 sourceDoc，不靠 id）。
 * 保留中文，替换非法字符，避免与文件名净化冲突。
 */
function entryIdForDoc(bookId: string, docName: string): string {
  const base = docName
    .replace(/\.md$/i, "")
    .replace(/[^a-zA-Z0-9一-鿿_-]/g, "_");
  return `${bookId}__${base}`;
}

/** 确保世界书存在：读不到则创建一个空 entries 的项目级世界书（不落盘，由调用方 save）。 */
async function ensureWorldLorebook(
  worldId: string,
  ownerId: string,
  projectId: string,
  hasWorldDocs: boolean
): Promise<Lorebook | null> {
  const existing = await tavernStore.readLorebook(worldId);
  if (existing) return existing;
  // 仅当确有世界类 .md 要同步时才实体化空世界书（避免为无世界文档的项目凭空建壳）。
  if (!hasWorldDocs) return null;
  return {
    id: worldId,
    entries: [],
    novelchat: { ownerId, projectId, kind: "project" },
  };
}

/**
 * 把若干世界类 .md 同步进世界书（幂等）。原地改 book.entries 后统一 saveLorebook。
 * 已存在 entry：仅覆盖 content 与 name（doc.name 去 .md），保留所有人工维护字段。
 * 新 entry：默认 enabled/constant/position/keys 等。
 * @returns 实际同步（新增或更新）的 entry 数量。
 */
async function syncWorldDocs(
  project: Project,
  ownerId: string,
  recs: DocRecord[]
): Promise<number> {
  const worldId = worldLorebookIdFor(project.id);
  const book = await ensureWorldLorebook(
    worldId,
    ownerId,
    project.id,
    recs.length > 0
  );
  if (!book) return 0;

  const entries: LorebookEntry[] = book.entries ? [...book.entries] : [];

  // 建立 sourceDoc → 在 entries 中的下标映射，用于幂等匹配（绝不重复建 entry）。
  const bySource = new Map<string, number>();
  entries.forEach((e, i) => {
    const src = e.novelchat?.sourceDoc;
    if (src) bySource.set(src, i);
  });
  let maxOrder = entries.reduce(
    (m, e) => Math.max(m, e.insertion_order ?? 0),
    0
  );

  let count = 0;
  for (const rec of recs) {
    const baseName = rec.name.replace(/\.md$/i, "");
    const idx = bySource.get(rec.name);
    if (idx !== undefined) {
      // 已存在：仅覆盖 content + name；保留 keys/secondary_keys/enabled/insertion_order/
      // constant/position/priority/selective/case_sensitive 等全部人工维护字段。
      const existing = entries[idx];
      entries[idx] = {
        ...existing,
        content: rec.body,
        name: baseName,
        novelchat: { ...(existing.novelchat || {}), sourceDoc: rec.name },
      };
    } else {
      const newEntry: LorebookEntry = {
        id: entryIdForDoc(worldId, rec.name),
        keys: [],
        content: rec.body,
        enabled: true,
        insertion_order: maxOrder + 1,
        constant: false,
        position: "after_char",
        name: baseName,
        novelchat: { sourceDoc: rec.name },
      };
      entries.push(newEntry);
      bySource.set(rec.name, entries.length - 1);
      maxOrder += 1;
    }
    count += 1;
  }

  book.entries = entries;
  await tavernStore.saveLorebook(book);
  return count;
}

/**
 * 把单个人物类 .md 经 codexId 链接同步进角色卡：仅覆盖 data.description（可编辑人设段），
 * 其余字段（personality/scenario/first_mes/...）全部保留。找不到匹配 codex 返回 false。
 */
async function syncCharacterCard(
  project: Project,
  codexId: string,
  rec: DocRecord
): Promise<void> {
  // loadCharacter：优先读已存角色卡（保留人手维护字段），无卡则回退 codex→V2。
  const card = await loadCharacter(codexId, project);
  card.data.description = rec.body; // Q5：仅覆盖可编辑的人设描述，不触碰其它维度
  await saveCharacter(card);
}

/**
 * 遍历 project.codex 的「人物」条目，按 人物设定_<name>.md 找文档并同步。
 * @returns 实际同步的角色卡数量。
 */
async function syncCharacterDocs(project: Project): Promise<number> {
  let count = 0;
  for (const entry of project.codex) {
    if (entry.category !== "人物") continue;
    const docName = `人物设定_${entry.name}.md`;
    const rec = await docsStore.read(project.id, docName);
    if (!rec) continue; // 文档缺失：优雅跳过（不写回 codex，Q4）
    await syncCharacterCard(project, entry.id, rec);
    count += 1;
  }
  return count;
}

/**
 * 同步【全部】项目文档进酒馆（Q5 单向、幂等）。
 *
 * 映射：
 *   - world   → 项目世界书 entries（按 sourceDoc 幂等）
 *   - character（人物设定_<name>.md）→ codexId 链接的角色卡 description
 *   - outline/inspiration/other → 无酒馆目标（MVP），计为 skipped，不写任何东西
 *
 * 约束：绝不调用 docsStore.save/remove（不回写 .md，Q5）；绝不 mutable 改 project.codex（Q4）。
 */
export async function syncDocsToTavern(
  project: Project,
  ownerId: string
): Promise<SyncResult> {
  const worldId = worldLorebookIdFor(project.id);

  const docs = await docsStore.list(project.id);
  const worldRecs: DocRecord[] = [];
  let skipped = 0;

  for (const d of docs) {
    if (d.kind === "world") {
      const rec = await docsStore.read(project.id, d.name);
      if (rec) worldRecs.push(rec);
    } else if (
      d.kind === "outline" ||
      d.kind === "inspiration" ||
      d.kind === "other"
    ) {
      // Q5：MVP 仅 world→世界书、character→角色卡 两类同步；
      // outline/inspiration/other 无对应酒馆目标，单向不回写，仅计数。
      skipped += 1;
    }
    // character 类由 codex 驱动（见 syncCharacterDocs），此处不计入 skipped。
  }

  let worldDocs = 0;
  if (worldRecs.length > 0) {
    worldDocs = await syncWorldDocs(project, ownerId, worldRecs);
  }

  const characterDocs = await syncCharacterDocs(project);

  return {
    worldDocs,
    characterDocs,
    skipped,
    worldLorebookId: worldId,
  };
}

/**
 * 同步【单篇】文档进酒馆（Q5 单向、幂等）。供 FT-22 的「.md 同步」按钮调用。
 *
 * - world   → 新建/更新世界书 entry（按 sourceDoc 匹配）
 * - character（人物设定_<name>.md）→ 经 codexId 链接更新角色卡 description
 * - outline/inspiration/other → 无酒馆目标，仅计 skipped=1
 * - 文档不存在（read 返回 null）→ 全 0，worldLorebookId 仍回传
 *
 * 约束同 syncDocsToTavern：不回写 .md，不写 codex。
 */
export async function syncDocToTavern(
  project: Project,
  ownerId: string,
  docName: string
): Promise<SyncResult> {
  const worldId = worldLorebookIdFor(project.id);
  const empty: SyncResult = {
    worldDocs: 0,
    characterDocs: 0,
    skipped: 0,
    worldLorebookId: worldId,
  };

  const rec = await docsStore.read(project.id, docName);
  if (!rec) return empty;

  if (rec.kind === "world") {
    await syncWorldDocs(project, ownerId, [rec]);
    return { ...empty, worldDocs: 1 };
  }

  if (rec.kind === "character") {
    // 从 人物设定_<name>.md 解析人物名，再经 codex 找到 codexId 链接。
    const m = /^人物设定_(.+)\.md$/i.exec(rec.name);
    const charName = m ? m[1] : rec.name.replace(/\.md$/i, "");
    const entry = project.codex.find(
      (e) => e.category === "人物" && e.name === charName
    );
    if (!entry) {
      // 文档存在但无匹配 codex 条目：无酒馆目标（无 codexId 链接），不写回。
      return { ...empty, skipped: 0, characterDocs: 0 };
    }
    await syncCharacterCard(project, entry.id, rec);
    return { ...empty, characterDocs: 1 };
  }

  // outline / inspiration / other：MVP 无酒馆目标，仅计数。
  return { ...empty, skipped: 1 };
}

// JSON → .md 共存迁移（FT-10，Q3「.md 为主」+ Q5「单向同步」）
//
// 职责：
//   - migrateBibleToDocs(project): 首开旧书时，把 project.bible（JSON）一次性拆为
//     `.md` 落 docsStore（世界观.md / 人物设定_<name>.md / 大纲.md）。旧 JSON **不删**，
//     作缓存兜底（Q3）。已存在同名 .md 则跳过 → 幂等（避免重复迁移）。
//   - syncDocsToBible(project, draft): 确认写入设定类 .md 后，回填 project.bible 对应
//     切片（保持 JSON 缓存与 .md 一致，单向）。调用方负责把 project 存盘。
//
// 设计取舍（GitHub 取经）：大型 JSON→Markdown 一次性迁移的幂等写法 = 迁移前先
// list 现有 .md，已存在同名则跳过（不覆盖、不重写），二次调用零副作用。

import { docsStore, type DocMeta } from "./docsStore";
import type { Project, StoryBible, Character, Volume } from "./types";
import type { MdDraft } from "./agent/types";

/** bible 缺省值（syncDocsToBible 在 bible 为 null 时惰性创建）。 */
function emptyBible(): StoryBible {
  return {
    logline: "",
    synopsis: "",
    worldbuilding: "",
    themes: "",
    tone: "",
    characters: [],
  };
}

/** 去掉首行可能的 `# 标题`，让 bible 字段保持纯净正文（Q5 单向同步源即 .md 正文）。 */
function stripLeadingTitle(body: string): string {
  return body.replace(/^\s*#\s+.*\r?\n/, "").trim();
}

function composeWorldMd(bible: StoryBible, title: string): string {
  const parts: string[] = [`# 世界观 · ${title}`];
  if (bible.logline) parts.push(`> 故事内核：${bible.logline}`);
  if (bible.synopsis) parts.push(`## 梗概\n\n${bible.synopsis}`);
  if (bible.worldbuilding) parts.push(`## 世界观\n\n${bible.worldbuilding}`);
  if (bible.themes) parts.push(`## 主题与基调\n\n${bible.themes}`);
  if (bible.tone) parts.push(`## 文风与视角\n\n${bible.tone}`);
  return parts.join("\n\n") + "\n";
}

function composeCharacterMd(c: Character): string {
  const parts: string[] = [`# 人物 · ${c.name}`];
  if (c.role) parts.push(`- 定位：${c.role}`);
  if (c.profile) parts.push(`## 小传\n\n${c.profile}`);
  return parts.join("\n\n") + "\n";
}

function composeOutlineMd(volumes: Volume[]): string {
  const parts: string[] = ["# 大纲"];
  for (const v of volumes) {
    parts.push(`## 第${v.index}卷 · ${v.title}`);
    if (v.summary) parts.push(v.summary);
    const chs = v.chapters
      .map((c) => `### 第${c.index}章 ${c.title}\n${c.synopsis || ""}`)
      .join("\n\n");
    if (chs) parts.push(chs);
  }
  return parts.join("\n\n") + "\n";
}

/**
 * 首开旧书：把 project.bible 拆为 .md 落 docsStore。幂等（同名跳过），旧 JSON 不删。
 * 返回本次应呈现的文档元信息（已存在者从存储读回，新写者取回写回值）。
 */
export async function migrateBibleToDocs(project: Project): Promise<DocMeta[]> {
  const metas: DocMeta[] = [];
  if (!project.bible) return metas;

  const existing = new Set(
    (await docsStore.list(project.id)).map((m) => m.name)
  );

  // 1) 世界观.md（world）——只要 bible 任一叙事字段非空即产出
  const hasWorld = !!(
    project.bible.worldbuilding ||
    project.bible.logline ||
    project.bible.synopsis ||
    project.bible.themes ||
    project.bible.tone
  );
  if (hasWorld) {
    const name = "世界观.md";
    if (existing.has(name)) {
      const rec = await docsStore.read(project.id, name);
      if (rec) metas.push(rec);
    } else {
      metas.push(
        await docsStore.save(
          project.id,
          name,
          composeWorldMd(project.bible, project.title),
          "world"
        )
      );
    }
  }

  // 2) 人物设定_<name>.md（character）——bible 每个角色一份
  for (const c of project.bible.characters) {
    const name = `人物设定_${c.name}.md`;
    if (existing.has(name)) {
      const rec = await docsStore.read(project.id, name);
      if (rec) metas.push(rec);
    } else {
      metas.push(
        await docsStore.save(project.id, name, composeCharacterMd(c), "character")
      );
    }
  }

  // 3) 大纲.md（outline）——bible 无大纲字段，大纲结构在分卷脉络 volumes
  if (project.volumes.length) {
    const name = "大纲.md";
    if (existing.has(name)) {
      const rec = await docsStore.read(project.id, name);
      if (rec) metas.push(rec);
    } else {
      metas.push(
        await docsStore.save(
          project.id,
          name,
          composeOutlineMd(project.volumes),
          "outline"
        )
      );
    }
  }

  return metas;
}

/**
 * 确认写入设定类 .md 后，单向回填 project.bible 对应切片（Q5）。
 * 不负责存盘——调用方（确认写入闭环 / applyMdDraftToStorage）落库 project。
 * 章节类（kind==="chapter"）不回填 bible（章节正文在 volumes，不走 bible 缓存）。
 */
export async function syncDocsToBible(
  project: Project,
  draft: MdDraft
): Promise<void> {
  if (draft.kind !== "setting") return;
  if (!project.bible) project.bible = emptyBible();

  const body = draft.body ? stripLeadingTitle(draft.body) : "";

  switch (draft.settingKind) {
    case "world":
      project.bible.worldbuilding = body;
      break;
    case "character": {
      const name = draft.fileName
        .replace(/\.md$/i, "")
        .replace(/^人物设定_/, "");
      const ch = project.bible.characters.find((c) => c.name === name);
      if (ch) ch.profile = body;
      else project.bible.characters.push({ name, role: "", profile: body });
      break;
    }
    case "outline":
      // 大纲正文回到 bible.synopsis（结构级摘要切片）
      project.bible.synopsis = body;
      break;
    case "inspiration":
    case "other":
    default:
      // 灵感 / 其他暂无 bible 切片，单向同步跳过（.md 仍为事实源）
      break;
  }
}

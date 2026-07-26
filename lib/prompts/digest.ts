// 章节归档（digest）提示词构造。从原 lib/prompts.ts 搬来，逻辑未改。

import type { Chapter } from "../types";
import type { ChatMessage } from "../llm";
import { SYSTEM_ARCHIVIST } from "./shared";

/**
 * After a chapter is written, extract a concise summary plus codex/foreshadow
 * updates so the continuity tables stay current. Returns JSON.
 */
export function buildDigestPrompt(
  chapter: Chapter,
  content: string,
  knownCodex: { name: string; status?: string }[],
  openForeshadows: string[],
  globalNo?: number
): ChatMessage[] {
  const known = knownCodex.length
    ? knownCodex
        .map((c) => (c.status ? `${c.name}（${c.status}）` : c.name))
        .join("、")
    : "（暂无）";
  const open = openForeshadows.length
    ? openForeshadows.join("、")
    : "（暂无）";
  return [
    { role: "system", content: SYSTEM_ARCHIVIST },
    {
      role: "user",
      content: `下面是刚完成的「第${globalNo ?? chapter.index}章 ${chapter.title}」正文。请阅读后归档。

已知设定条目（括号内为当前状态；若本章使其状态变化，请在 codex 中用相同 name 更新）：${known}
当前未回收的伏笔（若本章有强化或回收，请在 foreshadows 中用相同 title 更新）：${open}

【正文】
${content.slice(0, 12000)}

请输出如下 JSON（字段均为选填，无内容则用空数组/空串）：
{
  "summary": "本章精炼摘要（120字内：发生了什么、人物关系/状态变化、留下的悬念）",
  "codex": [
    { "category": "人物/地点/物品/势力/设定/其他", "name": "名称", "aliases": ["别名"], "summary": "截至本章的关键信息与最新状态", "status": "人物/势力的存续状态，如 存活/死亡/失踪/重伤（非人物可留空）", "event": "本章该实体发生的关键变化（一句话，无则留空）" }
  ],
  "foreshadows": [
    { "title": "伏笔简述", "detail": "具体线索", "action": "plant|reinforce|pay|abandon", "payoffPlan": "预期如何回收（可选）" }
  ],
  "conflicts": ["若本章内容与上述已知设定/状态存在矛盾（如已死角色再次登场、位置/关系与前文不符），在此简要指出；无则留空数组"]
}

要求：
1. 只登记真正重要、会影响后续连贯性的信息；琐碎细节不要入库。
2. codex 中已存在的条目用同名覆盖更新（包括 status）；新人物/新设定才新增。event 只填“本章”的新变化。
3. action：plant=本章新埋伏笔，reinforce=强化已有伏笔，pay=回收，abandon=明确废弃。
4. conflicts 仅用于提醒作者，不要自行“修正”正文事实；如实抽取。
5. 只输出 JSON。`,
    },
  ];
}

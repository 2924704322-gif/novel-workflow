// 卷级与滚动前情提示词构造。从原 lib/prompts.ts 搬来，逻辑未改。

import type { ProjectSetup, StoryBible, Volume } from "../types";
import type { ChatMessage } from "../llm";
import type { RecentSummary } from "../retrieval";
import {
  SYSTEM_PLANNER,
  SYSTEM_RECAP,
  bibleBlock,
  creativeIntent,
  regenDirectionBlock,
} from "./shared";

/** Step 2: plan the volume-level outline from a finalized bible. Returns JSON. */
export function buildVolumesPrompt(
  setup: ProjectSetup,
  bible: StoryBible,
  direction?: string
): ChatMessage[] {
  const totalChapters =
    setup.targetChapters && setup.targetChapters > 0 ? setup.targetChapters : 0;
  const explicitVolumes =
    setup.targetVolumes && setup.targetVolumes > 0 ? setup.targetVolumes : 0;
  const volumeCount =
    explicitVolumes > 0
      ? explicitVolumes
      : totalChapters > 0
      ? Math.max(3, Math.min(24, Math.round(totalChapters / 30)))
      : Math.max(6, Math.min(20, Math.round(setup.targetWords / 120000)));
  const volumeRule =
    explicitVolumes > 0
      ? `严格规划 ${volumeCount} 卷（用户指定的分卷 / 脉络段数，请精确输出该数量，不要多也不要少）`
      : `规划 ${volumeCount} 卷左右`;
  const chapterRule =
    totalChapters > 0
      ? `各卷的 chapterCount 之和应控制在 ${totalChapters} 章左右（全书总章数），并在各卷间合理分配。`
      : `每卷的 chapterCount 结合单章约 ${setup.wordsPerChapter} 字来估算，使总字数接近目标。`;
  return [
    { role: "system", content: SYSTEM_PLANNER },
    {
      role: "user",
      content: `以下是这部小说已定稿的【故事设定集】：

${bibleBlock(bible)}

${creativeIntent(setup)}
${regenDirectionBlock(direction)}
请据此规划【分卷脉络】，输出如下结构的 JSON：
{
  "volumes": [
    { "title": "第一卷 卷名", "summary": "本卷主线剧情概述（150字以上，说明本卷起止事件、关键转折与卷末钩子）", "chapterCount": 20 }
  ]
}

要求：
1. ${volumeRule}，各卷之间存在清晰的剧情递进与矛盾升级，整体走向与设定集的梗概保持一致。
2. ${chapterRule}
3. 只输出 JSON。`,
    },
  ];
}

/** Level 2: expand one volume into chapter-level synopses. Returns JSON. */
export function buildVolumeChaptersPrompt(
  setup: ProjectSetup,
  bible: StoryBible,
  volume: Volume,
  chapterCount: number
): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PLANNER },
    {
      role: "user",
      content: `以下是这部小说的整体设定：

${bibleBlock(bible)}

现在请把【${volume.title}】细化为 ${chapterCount} 章的章节细纲。
本卷主线：${volume.summary}
单章目标字数：约 ${setup.wordsPerChapter} 字。

请输出如下 JSON：
{
  "chapters": [
    { "title": "本章标题（不含“第X章”前缀）", "synopsis": "本章剧情要点（80-150字：本章发生的关键事件、人物行动、情绪转折、章末悬念）" }
  ]
}

要求：
1. 恰好输出 ${chapterCount} 章。
2. 章与章之间衔接自然，节奏有张有弛，每隔数章设置一个小高潮，卷末章要有强钩子。
3. 与整体世界观、人物设定保持一致，可埋设伏笔。
4. 只输出 JSON。`,
    },
  ];
}

/**
 * Tier-2 memory: condense one volume's finished-chapter summaries into a rolling
 * arc summary ("what has happened in this volume so far"). Optionally continues
 * from a previous arc snapshot so the summary stays stable as chapters accrue.
 */
export function buildVolumeArcPrompt(
  volume: Volume,
  chapterSummaries: RecentSummary[],
  prevArc?: string
): ChatMessage[] {
  const list = chapterSummaries.length
    ? chapterSummaries
        .map((r) => `- 第${r.global}章「${r.title}」：${r.summary}`)
        .join("\n")
    : "（本卷暂无已归档的章节摘要）";
  const prev = (prevArc || "").trim()
    ? `\n【本卷此前的概述（可参考并在其基础上更新）】\n${prevArc!.trim()}\n`
    : "";
  return [
    { role: "system", content: SYSTEM_RECAP },
    {
      role: "user",
      content: `请把【${volume.title}】截至目前的剧情归纳为一段“本卷至今概述”。
本卷主线：${volume.summary || "（暂无）"}
${prev}
【本卷已完成章节摘要（按顺序）】
${list}

要求：
1. 用 200-400 字，按时序讲清本卷已发生的关键事件、人物处境与状态变化、尚未收束的悬念。
2. 覆盖全过程，不要只写开头或结尾；合并琐碎细节，突出影响后续的主线。
3. 只输出这段概述正文，不要输出标题、列表符号或任何说明文字。`,
    },
  ];
}

/**
 * Tier-1 memory: synthesize the arc summaries of all finished volumes into a
 * whole-book "story so far" recap, bridging the gap between the static bible and
 * the current volume so long-range plot lines are not forgotten mid-book.
 */
export function buildStorySoFarPrompt(
  bible: StoryBible,
  priorArcs: { index: number; title: string; arc: string }[]
): ChatMessage[] {
  const list = priorArcs.length
    ? priorArcs
        .map((v) => `第${v.index}卷「${v.title}」：${v.arc}`)
        .join("\n\n")
    : "（暂无已完成的分卷）";
  return [
    { role: "system", content: SYSTEM_RECAP },
    {
      role: "user",
      content: `以下是这部小说各已完成分卷的概述。请综合为一段贯通全书的“先前各卷故事梗概”，供作者创作后续卷时回顾。

【作品基调】${bible.tone || "（未标注）"}

【各卷概述（按顺序）】
${list}

要求：
1. 用 300-500 字，按时序讲清全书至今的主干推进：核心矛盾的演变、主要人物的处境与关系变化、已埋设或已回收的重要伏笔。
2. 综合去重、承前启后，形成连贯叙述，不要逐卷罗列流水账，也不要臆造未提供的情节。
3. 只输出这段梗概正文，不要输出标题、列表符号或任何说明文字。`,
    },
  ];
}

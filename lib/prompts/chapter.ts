// 章节细纲与章节正文提示词构造。从原 lib/prompts.ts 搬来，逻辑未改。

import type {
  Chapter,
  PromptEntry,
  ProjectSetup,
  StoryBible,
  Volume,
} from "../types";
import type { ChatMessage } from "../llm";
import { effectiveStyleCards } from "../types";
import type { ChapterContext } from "../retrieval";
import {
  SYSTEM_PLANNER,
  SYSTEM_WRITER,
  bibleBlock,
  creativeIntent,
  codexBlock,
  deAiBlock,
  foreshadowBlock,
  nextChapterBoundaryBlock,
  promptLibraryBlock,
  recapBlock,
  recentBlock,
  regenDirectionBlock,
  styleCardBlock,
} from "./shared";

/**
 * Regenerate one chapter's outline, or continue with the next chapter's
 * outline, using the volume's existing chapters as context. Returns JSON for
 * a single chapter { title, synopsis }.
 */
export function buildChapterOutlinePrompt(
  setup: ProjectSetup,
  bible: StoryBible,
  volume: Volume,
  opts: {
    mode: "regen" | "next";
    targetIndex?: number;
    globalStart?: number;
    direction?: string;
  }
): ChatMessage[] {
  const { mode, targetIndex, globalStart = 1, direction } = opts;
  const list = volume.chapters
    .map((c, i) => {
      const no = globalStart + i;
      const mark =
        mode === "regen" && targetIndex === c.index
          ? "　←【需要重新生成脉络的本章】"
          : "";
      return `第${no}章 ${c.title}：${c.synopsis || "（暂无脉络）"}${mark}`;
    })
    .join("\n");
  const listBlock = list
    ? `本卷现有章节脉络（按顺序）：\n${list}`
    : "本卷暂无章节脉络。";
  const task =
    mode === "regen"
      ? `请只针对上面标注【需要重新生成脉络的本章】的那一章，重写其标题与脉络，与前后章节自然衔接、避免与相邻章节重复，并推动本卷主线。`
      : `请紧接本卷最后一章之后，续写“下一章”的标题与脉络，与已有章节自然衔接、推进本卷主线，避免重复已发生的情节。`;
  return [
    { role: "system", content: SYSTEM_PLANNER },
    {
      role: "user",
      content: `以下是这部小说的整体设定：

${bibleBlock(bible)}

【当前卷】${volume.title}
本卷主线：${volume.summary}
单章目标字数：约 ${setup.wordsPerChapter} 字。

${listBlock}
${regenDirectionBlock(direction)}
${task}

请输出如下 JSON（只描述这一章）：
{
  "title": "本章标题（不含‘第X章’前缀）",
  "synopsis": "本章脉络（80-150字：关键事件、人物行动、情绪转折、章末悬念）"
}

要求：
1. 只输出一章的 JSON，不要输出章节数组。
2. 与整体世界观、人物设定及本卷已有章节保持一致。
3. 只输出 JSON。`,
    },
  ];
}

/** Write a single chapter body. Streams prose. */
export function buildChapterPrompt(
  setup: ProjectSetup,
  bible: StoryBible,
  volume: Volume,
  chapter: Chapter,
  prevChapter: Chapter | null,
  ctx?: ChapterContext,
  globalNo?: number,
  direction?: string,
  promptLib?: PromptEntry[],
  nextChapter?: Chapter | null
): ChatMessage[] {
  const prevTail = prevChapter?.content
    ? prevChapter.content.slice(-1200)
    : "";
  const prevBlock = prevChapter
    ? `【上一章「${prevChapter.title}」结尾片段（用于承接，勿重复照抄）】\n${
        prevTail || prevChapter.synopsis
      }`
    : "【本章为全书开篇，请写好引人入胜的开头】";

  const contextBlocks = ctx
    ? [
        recapBlock(ctx.storySoFar, ctx.volumeArc),
        codexBlock(ctx.codex),
        recentBlock(ctx.recent),
        foreshadowBlock(ctx.foreshadows),
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";

  const deAi = deAiBlock(setup);
  const style = styleCardBlock(effectiveStyleCards(setup));

  const body = [
    bibleBlock(bible),
    creativeIntent(setup),
    contextBlocks,
    `【当前卷】${volume.title}\n本卷主线：${volume.summary}`,
    prevBlock,
    `【需要创作的本章】第${globalNo ?? chapter.index}章 ${chapter.title}\n本章细纲：${chapter.synopsis}`,
    nextChapterBoundaryBlock(
      nextChapter,
      globalNo ? globalNo + 1 : undefined
    ),
    style,
    deAi,
    promptLibraryBlock(promptLib),
    regenDirectionBlock(direction),
    `创作要求：
1. 目标字数约 ${setup.wordsPerChapter} 字，请在本章细纲范围内写足；宁可放慢节奏、丰富场景/对话/细节与人物内心，也不要靠推进后续情节来凑字数。
2. 严格且仅围绕本章细纲展开，本章只覆盖细纲所述事件，写到细纲收尾即止；不得提前叙写或展开后续章节才应发生的情节、场景或结局；若有下一章边界提示，务必在该边界前收束。推进而不是复述已有剧情，与前文自然衔接，与上述设定档案保持一致。
3. 保持既定文风（${setup.style || bible.tone}），多用场景、对话与细节，少用空泛概述。
4. 结尾就本章事件收束，可留一句承接下一章的钩子或余韵，但不得实际进入下一章情节。
5. 只输出正文，分自然段，不要输出章节标题或任何说明文字。`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system", content: SYSTEM_WRITER },
    { role: "user", content: body },
  ];
}

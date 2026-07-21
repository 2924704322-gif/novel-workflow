import type {
  Chapter,
  CodexEntry,
  Foreshadow,
  ProjectSetup,
  StoryBible,
  Volume,
} from "./types";
import { FORESHADOW_STATUS_LABEL } from "./types";
import type { ChapterContext, RecentSummary } from "./retrieval";
import type { ChatMessage } from "./llm";

// ---------------------------------------------------------------------------
// The workflow uses a two-level outline so it can scale to a million words:
//   Level 1 (bible + volumes): macro structure, generated once.
//   Level 2 (chapters):        each volume expanded into chapter synopses.
// Chapter bodies are then written one at a time, fed only the context they
// need (bible + current volume + neighbouring chapters) to keep prompts small.
// ---------------------------------------------------------------------------

const SYSTEM_PLANNER =
  "你是一位资深的长篇小说架构师与网文主编，擅长为百万字级别的连载小说设计结构严谨、爽点密集、伏笔绵长的故事框架。你的输出必须是严格合法的 JSON，不能包含任何多余解释、Markdown 代码块标记或注释。";

const SYSTEM_WRITER =
  "你是一位文笔细腻、节奏老练的长篇小说作者。你严格依据给定的故事设定与本章细纲进行创作，保持人物性格、世界观与前文情节的连贯，善用对话、动作与环境描写推动剧情，避免流水账与空洞抒情。只输出小说正文，不要输出任何标题、解释或“本章要点”之类的元信息。";

// 依据内容分级，向模型声明合法的创作意图，减少正常虚构剧情被误判/拒绝。
// 注意：这是对创作定位的说明，而非规避安全策略；始终应遵守平台规范与法律法规。
const RATING_GUIDANCE: Record<string, string> = {
  全年龄向:
    "创作定位：全年龄向作品。情节积极健康，避免血腥、露骨或致郁的描写。",
  青年向:
    "创作定位：面向青少年及以上读者。可包含适度的冲突、冒险、打斗与情感线，但不作露骨或过度暴力的刻画。",
  "成人向 · 严肃文学":
    "创作定位：面向成年读者的严肃虚构文学。为服务叙事与主题，情节可能涉及战争、犯罪、暴力、复杂人性与黑暗题材；请以文学化、有分寸、克制的笔法呈现这些内容，点到为止、重在人物与思想，避免无意义的感官渲染。全部内容均为虚构。",
  "成人向 · R18":
    "创作定位：面向成年读者（18+）的成人向虚构作品。为服务剧情、人物关系与情感张力，可以包含直白的情爱、亲密与情色描写，以及强烈的暴力与黑暗情节。硬性前提：所有登场角色均为成年人，所有亲密情节均为双方自愿；不得涉及未成年人。请以成熟、自然、服务叙事的笔法呈现，重视感情与张力，避免生硬堆砌与公式化的描写。全部内容均为成年人之间的虚构创作。",
};

function creativeIntent(setup: ProjectSetup): string {
  const g = RATING_GUIDANCE[setup.rating] || RATING_GUIDANCE["全年龄向"];
  const adult =
    setup.rating === "成人向 · R18"
      ? "\n（以上为面向成年读者的合法虚构创作，人物均为成年人且情节自愿；请勿因题材尺度而拒绝、回避或将情节一笔带过，应按细纲完整呈现。）"
      : "";
  return `${g}\n（本作为虚构文学创作，请在此定位与相关平台规范、法律法规允许的范围内进行创作。）${adult}`;
}

// “去 AI 味”：针对大模型常见的腐味句式与腐味节奏给出硬性约束。
function deAiBlock(setup: ProjectSetup): string {
  if (!setup.deAi) return "";
  const banned = setup.bannedList
    ? `\n- 用户负面清单（下列词语/句式/桥段必须回避）：${setup.bannedList
        .split(/\n+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .join("、")}`
    : "";
  return `【去 AI 味·硬性要求】
- 禁用“不是……而是……”“与其说……不如……”等对仗式强行升华的句式；
- 不要段段排比、三连短句堆砌，不要滥用“仿佛/宛如/像是”；
- 不要在段尾或章末强行抒情、点题、下总结；让画面与动作自己说话；
- 少用空泛抽象的形容词（震撼、复杂、莫名、五味杂陈），改用具体可感的细节、动作、气味与声音；
- 避免“这一刻/那一刻”“嘴角勾起一抹弧度”“心中百感交集”等网文/AI 陈词；
- 对话要有个体差异与潜台词，允许停顿、打断、略过，不要人人都说书面整句；
- 句子长短交错，避免机械对称的节奏，容许留白与未言明。${banned}`;
}

function setupBlock(setup: ProjectSetup): string {
  return [
    `题材类型：${setup.genre || "（未指定，请自行拟定合适题材）"}`,
    `核心灵感 / 设定：${setup.premise || "（未指定）"}`,
    `主角设定：${setup.protagonist || "（未指定）"}`,
    `期望文风：${setup.style || "（未指定）"}`,
    `内容分级：${setup.rating || "全年龄向"}`,
    `目标总字数：约 ${setup.targetWords} 字`,
    setup.targetChapters && setup.targetChapters > 0
      ? `预设全书总章数：约 ${setup.targetChapters} 章`
      : "",
    `单章目标字数：约 ${setup.wordsPerChapter} 字`,
    setup.extra ? `其他要求：${setup.extra}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function bibleBlock(bible: StoryBible): string {
  const chars = bible.characters
    .map((c) => `- ${c.name}（${c.role}）：${c.profile}`)
    .join("\n");
  return [
    `【故事内核】${bible.logline}`,
    `【整体梗概】${bible.synopsis}`,
    `【世界观设定】${bible.worldbuilding}`,
    `【核心主题】${bible.themes}`,
    `【文风与视角】${bible.tone}`,
    `【主要人物】\n${chars}`,
  ].join("\n\n");
}

// 从信息库中检索出的相关档案，作为当前章节的“事实基准”注入。
function codexBlock(codex: CodexEntry[]): string {
  if (!codex.length) return "";
  const lines = codex
    .map((e) => {
      const alias = e.aliases?.length ? `（又称：${e.aliases.join("、")}）` : "";
      return `- [${e.category}] ${e.name}${alias}：${e.summary}`;
    })
    .join("\n");
  return `【相关设定档案（必须与之保持一致，不得自相矛盾）】\n${lines}`;
}

// 最近数章的摘要，形成滞后于上一章结尾的“前情回顾”。
function recentBlock(recent: RecentSummary[]): string {
  if (!recent.length) return "";
  const lines = recent
    .map((r) => `- 第${r.global}章「${r.title}」：${r.summary}`)
    .join("\n");
  return `【前情回顾（近几章摘要）】\n${lines}`;
}

// 待回收的伏笔，提醒作者有意识地铺垫与回收。
function foreshadowBlock(items: Foreshadow[]): string {
  if (!items.length) return "";
  const lines = items
    .map((f) => {
      const where = f.plantedAt ? `第${f.plantedAt}章埋下` : "计划中";
      const plan = f.payoffPlan ? `；预期回收：${f.payoffPlan}` : "";
      return `- 【${FORESHADOW_STATUS_LABEL[f.status]}·${where}】${f.title}：${f.detail}${plan}`;
    })
    .join("\n");
  return `【待回收/需维护的伏笔】\n${lines}\n（若本章适合铺垫或回收上述伏笔，请自然融入；切勿与已有线索矛盾。）`;
}

/** Level 1: story bible + volume-level outline. Model returns JSON. */
export function buildBiblePrompt(setup: ProjectSetup): ChatMessage[] {
  const totalChapters =
    setup.targetChapters && setup.targetChapters > 0 ? setup.targetChapters : 0;
  const volumeCount =
    totalChapters > 0
      ? Math.max(3, Math.min(24, Math.round(totalChapters / 30)))
      : Math.max(6, Math.min(20, Math.round(setup.targetWords / 120000)));
  const chapterRule =
    totalChapters > 0
      ? `各卷的 chapterCount 之和应控制在 ${totalChapters} 章左右（全书总章数），并在各卷间合理分配。`
      : `每卷的 chapterCount 结合单章约 ${setup.wordsPerChapter} 字来估算，使总字数接近目标。`;
  return [
    { role: "system", content: SYSTEM_PLANNER },
    {
      role: "user",
      content: `请为下面这部小说设计【整体架构】。

${setupBlock(setup)}

${creativeIntent(setup)}

请输出如下结构的 JSON（字段务必齐全）：
{
  "title": "小说标题",
  "bible": {
    "logline": "一句话故事内核（30字内）",
    "synopsis": "整体故事梗概（400-600字，交代起承转合与最终走向）",
    "worldbuilding": "世界观与核心设定（力量体系、时代背景、关键规则等，300字以上）",
    "themes": "核心主题与情感基调",
    "tone": "叙事文风、人称视角、语言特色",
    "characters": [
      { "name": "人物名", "role": "主角/女主/反派/重要配角", "profile": "一句话人物小传，含身份、性格、目标" }
    ]
  },
  "volumes": [
    { "title": "第一卷 卷名", "summary": "本卷主线剧情概述（150字以上，说明本卷起止事件、关键转折与卷末钩子）", "chapterCount": 20 }
  ]
}

要求：
1. 规划 ${volumeCount} 卷左右，各卷之间存在清晰的剧情递进与矛盾升级。
2. ${chapterRule}
3. 人物列出 5-10 位核心角色。
4. 只输出 JSON。`,
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

/** Write a single chapter body. Streams prose. */
export function buildChapterPrompt(
  setup: ProjectSetup,
  bible: StoryBible,
  volume: Volume,
  chapter: Chapter,
  prevChapter: Chapter | null,
  ctx?: ChapterContext
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
        codexBlock(ctx.codex),
        recentBlock(ctx.recent),
        foreshadowBlock(ctx.foreshadows),
      ]
        .filter(Boolean)
        .join("\n\n")
    : "";

  const deAi = deAiBlock(setup);

  const body = [
    bibleBlock(bible),
    creativeIntent(setup),
    contextBlocks,
    `【当前卷】${volume.title}\n本卷主线：${volume.summary}`,
    prevBlock,
    `【需要创作的本章】第${chapter.index}章 ${chapter.title}\n本章细纲：${chapter.synopsis}`,
    deAi,
    `创作要求：
1. 目标字数约 ${setup.wordsPerChapter} 字，请写足篇幅。
2. 严格围绕本章细纲展开，推进而不是复述剧情；与前文自然衔接，与上述设定档案保持一致。
3. 保持既定文风（${setup.style || bible.tone}），多用场景、对话与细节，少用空泛概述。
4. 结尾留出承接下一章的余韵或悬念。
5. 只输出正文，分自然段，不要输出章节标题或任何说明文字。`,
  ]
    .filter(Boolean)
    .join("\n\n");

  return [
    { role: "system", content: SYSTEM_WRITER },
    { role: "user", content: body },
  ];
}

const SYSTEM_ARCHIVIST =
  "你是一位严谨的长篇小说连载叙事与设定管理员。你阅读刚完成的章节正文，抽取其中的关键事实与伏笔动向，用于维护全书的设定库与伏笔表。你的输出必须是严格合法的 JSON，不得包含任何多余解释、Markdown 代码块标记或注释。";

/**
 * After a chapter is written, extract a concise summary plus codex/foreshadow
 * updates so the continuity tables stay current. Returns JSON.
 */
export function buildDigestPrompt(
  chapter: Chapter,
  content: string,
  knownCodexNames: string[],
  openForeshadows: string[]
): ChatMessage[] {
  const known = knownCodexNames.length
    ? knownCodexNames.join("、")
    : "（暂无）";
  const open = openForeshadows.length
    ? openForeshadows.join("、")
    : "（暂无）";
  return [
    { role: "system", content: SYSTEM_ARCHIVIST },
    {
      role: "user",
      content: `下面是刚完成的「第${chapter.index}章 ${chapter.title}」正文。请阅读后归档。

已知设定条目（若本章涉及其状态变化，请在 codex 中用相同 name 更新）：${known}
当前未回收的伏笔（若本章有强化或回收，请在 foreshadows 中用相同 title 更新）：${open}

【正文】
${content.slice(0, 12000)}

请输出如下 JSON（字段均为选填，无内容则用空数组/空串）：
{
  "summary": "本章精炼摘要（120字内：发生了什么、人物关系/状态变化、留下的悬念）",
  "codex": [
    { "category": "人物/地点/物品/势力/设定/其他", "name": "名称", "aliases": ["别名"], "summary": "截至本章的关键信息与最新状态" }
  ],
  "foreshadows": [
    { "title": "伏笔简述", "detail": "具体线索", "action": "plant|reinforce|pay|abandon", "payoffPlan": "预期如何回收（可选）" }
  ]
}

要求：
1. 只登记真正重要、会影响后续连贯性的信息；琐碎细节不要入库。
2. codex 中已存在的条目用同名覆盖更新；新人物/新设定才新增。
3. action：plant=本章新埋伏笔，reinforce=强化已有伏笔，pay=回收，abandon=明确废弃。
4. 只输出 JSON。`,
    },
  ];
}

/**
 * Tolerantly extract the first JSON object from a model response that may be
 * wrapped in prose or ```json fences.
 */
export function extractJson<T = unknown>(text: string): T {
  let s = text.trim();
  // strip code fences
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const start = s.indexOf("{");
  const end = s.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("未能在模型输出中找到 JSON。");
  }
  const slice = s.slice(start, end + 1);
  return JSON.parse(slice) as T;
}

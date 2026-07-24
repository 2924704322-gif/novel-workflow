import type {
  Chapter,
  CodexEntry,
  Foreshadow,
  PromptEntry,
  ProjectSetup,
  StoryBible,
  StyleCard,
  Volume,
} from "./types";
import { FORESHADOW_STATUS_LABEL, PROMPT_SOURCE_LABEL, effectiveStyleCards } from "./types";
import type { ChapterContext, RecentSummary } from "./retrieval";
import type { ReconcileChange, ReconcilePayload } from "./reconcile";
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

// 重新生成时用户给出的调整方向：作为硬约束注入，引导模型在新方向上重新设计。空方向时返回空串，不影响原提示。
function regenDirectionBlock(direction?: string): string {
  const d = (direction || "").trim();
  if (!d) return "";
  return `\n【本次重新生成的调整方向】
请在与题材、基本设定保持合理的前提下，重点按以下方向重新调整，而非照搬上一版：
${d}
`;
}

// “去 AI 味”：依据维基百科「Signs of AI writing」的 24 类特征，针对中文小说
// 正文里最常见的 AI 腔句式、腔调词与机械节奏给出分类硬约束，并辅以正向的
// “写得鲜活”要求——避免只是“干净”而失去人味。
function deAiBlock(setup: ProjectSetup): string {
  if (!setup.deAi) return "";
  const banned = setup.bannedList
    ? `\n- 额外负面清单（下列词语/句式/桥段一并回避）：${setup.bannedList
        .split(/\n+/)
        .map((x) => x.trim())
        .filter(Boolean)
        .join("、")}`
    : "";
  return `【去 AI 味·硬性写作要求】
一、禁用的“AI 味”句式
- 对仗升华：禁“不是……而是……”“与其说……不如说……”“不仅是……更是……”这类强行拔高的对仗结构；
- 否定排比与三段式：禁“不是A，不是B，而是C”；禁形容词/名词的三词并列堆砌（“X、Y与Z”式三连）；
- 含糊归因与限定堆砌：别用“仿佛有某种”“像是被什么攫住”“某种难以名状的”搪塞，也别用“据说/似乎/大概/某种程度上”层层加限定，把动作与因果写实。
二、回避的“AI 味”高频词（正文中一律少用或改写）
缓缓、微微、轻轻、渐渐、不由得、不禁、不由自主、下意识、嘴角勾起 / 上扬、勾起一抹弧度、眼神复杂、眼中闪过、心中一紧 / 一沉、五味杂陈、百感交集、思绪万千、莫名的、说不出的、无法言喻、仿佛、宛如、恍若、这一刻、那一刻、空气仿佛凝固、时间仿佛静止、深吸一口气、久久、彰显、交织、织就、见证。
三、指代与重复
- 同一人物在相邻段落别用“男人/女人/青年/少年/对方/那人”来回换称以“避免重复”；正常用名字或“他/她”，适度重复不是错。
四、节奏与标点
- 句子长短交错，避免机械对称与整齐的三连短句；破折号、省略号、感叹号克制使用；不要每段都以景物、天气或情绪收尾。
五、段落与章节收束
- 段尾、章末不要强行抒情、点题、总结或升华；让画面、动作与对话自己收住，允许留白与未言明。
六、对话
- 对话要有个体差异与潜台词，允许停顿、打断、跳接、答非所问，不要人人都说完整的书面句。
七、比“干净”更重要的是“鲜活”
- 用具体可感的细节、动作、气味、声音、温度替代抽象概括（震撼、复杂、美好、温暖）；
- 人物对事件要有具体的态度与反应，而非中性旁白；允许适度的粗糙与不完美，真实胜过工整。${banned}`;
}

// 单张文风卡的量化特征文本（不含外层标题，供单/多卡场景复用）。
function oneStyleCardBlock(card: StyleCard): string {
  const lines = [
    card.signature ? `模仿指南：${card.signature}` : "",
    `句式节奏：平均句长 ${card.sentenceRhythm.avgLength || "不限"}；${card.sentenceRhythm.pattern}`,
    card.vocabulary.highFreqWords.length
      ? `用词倾向：可多用“${card.vocabulary.highFreqWords.slice(0, 10).join("、")}”类用词；语体为${card.vocabulary.register || "不限"}`
      : "",
    card.vocabulary.forbiddenWords.length
      ? `禁用词：${card.vocabulary.forbiddenWords.join("、")}`
      : "",
    `描写策略：动作与心理比重 ${card.descriptionStrategy.actionVsPsychology || "自定"}；${card.descriptionStrategy.sensoryPreference}`,
    `对话风格：口语化程度 ${card.dialogueStyle.colloquialScore}/10，潜台词密度${card.dialogueStyle.subtextDensity}；${card.dialogueStyle.tagHabit}`,
    `叙事：${card.narrativeStructure.perspective}；时间线${card.narrativeStructure.timeline}`,
    `情绪基调：${card.emotionalTone.tone}；以“${card.emotionalTone.expressionMode}”为主`,
    card.rhetoric.preferredTypes.length
      ? `修辞：偏好 ${card.rhetoric.preferredTypes.join("、")}，使用频率${card.rhetoric.frequency}`
      : "",
  ]
    .filter(Boolean)
    .map((x) => `- ${x}`)
    .join("\n");
  return `「${card.styleName}」\n${lines}`;
}

// 已应用的文风规则卡：把拆书得到的量化风格转为写作硬约束；支持多张融合。
function styleCardBlock(cards: StyleCard[]): string {
  if (!cards.length) return "";
  if (cards.length === 1) {
    return `【文风规则・请严格模仿以下文风】\n${oneStyleCardBlock(cards[0])}\n（请将上述风格自然融入本章创作，而非生硬套用；与已定文风冲突时以本规则卡为准。）`;
  }
  const names = cards.map((c) => `“${c.styleName}”`).join("、");
  const blocks = cards.map((c) => oneStyleCardBlock(c)).join("\n\n");
  return `【文风规则・请融合模仿以下 ${cards.length} 张文风卡：${names}】\n${blocks}\n（请将上述多张文风卡的特征自然融合为统一笔触，取其共性、兼容其个性，而非机械拼贴；与已定文风冲突时以上述规则卡为准。）`;
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
      const status = e.status ? `【${e.status}】` : "";
      // 附带最近几条状态变化，让模型看到实体的“演变轨迹”而非只有最新快照。
      const evs = (e.events || []).slice(-3);
      const timeline = evs.length
        ? `\n    历程：${evs.map((v) => `第${v.chapter}章 ${v.note}`).join("；")}`
        : "";
      return `- [${e.category}]${status} ${e.name}${alias}：${e.summary}${timeline}`;
    })
    .join("\n");
  return `【相关设定档案（必须与之保持一致，不得自相矛盾；已标注死亡/失踪等状态的不得擅自推翻）】\n${lines}`;
}

// 分层滚动前情：全书故事梗概（已完成分卷）+ 本卷至今概述，
// 弥合“故事圣经↔近几章”之间的中期断层，避免中后期遗忘长线情节。
function recapBlock(storySoFar?: string, volumeArc?: string): string {
  const parts: string[] = [];
  if (storySoFar && storySoFar.trim()) {
    parts.push(`【先前各卷故事梗概】\n${storySoFar.trim()}`);
  }
  if (volumeArc && volumeArc.trim()) {
    parts.push(`【本卷至今概述】\n${volumeArc.trim()}`);
  }
  return parts.join("\n\n");
}

// 最近数章的摘要，形成滞后于上一章结尾的“前情回顾”。
function recentBlock(recent: RecentSummary[]): string {
  if (!recent.length) return "";
  const lines = recent
    .map((r) => `- 第${r.global}章「${r.title}」：${r.summary}`)
    .join("\n");
  return `【前情回顾（近几章摘要）】\n${lines}`;
}

// 下一章边界·止步线：把下一章细纲作为负向约束注入，给模型一个明确的
// “到此为止”锚点，避免本章正文提前展开后续章节的情节而“串章”。
function nextChapterBoundaryBlock(
  nextChapter: Chapter | null | undefined,
  nextGlobalNo?: number
): string {
  const syn = nextChapter?.synopsis?.trim();
  if (!nextChapter || !syn) return "";
  const no = nextGlobalNo ? `第${nextGlobalNo}章` : "下一章";
  return `【下一章边界·止步线（本章严禁展开以下内容）】
${no}「${nextChapter.title}」的细纲：${syn}
（以上属于${no}的情节，本章不得提前叙写或展开其中的事件、场景与结局；至多在本章结尾用一两句话作为悬念或铺垫暗示，点到为止。）`;
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

/** Step 1: story bible only (no volumes). Model returns JSON. */
export function buildBiblePrompt(
  setup: ProjectSetup,
  direction?: string
): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_PLANNER },
    {
      role: "user",
      content: `请为下面这部小说设计【故事设定集】（本步骤只产出整体设定，暂不规划分卷）。

${setupBlock(setup)}

${creativeIntent(setup)}
${regenDirectionBlock(direction)}
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
  }
}

要求：
1. 人物列出 5-10 位核心角色，覆盖主角、对手与关键配角。
2. 设定内部自洽，为后续分卷与百万字连载留出足够的矛盾与成长空间。
3. 只输出 JSON。`,
    },
  ];
}

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

// 本书提示词库：作者累积的写作偏好 / 历次调整方向，作为持续性软约束注入。
function promptLibraryBlock(prompts?: PromptEntry[]): string {
  if (!prompts || !prompts.length) return "";
  const lines = prompts
    .map((p) => `- 【${PROMPT_SOURCE_LABEL[p.source]}】${p.content.trim()}`)
    .join("\n");
  return `【本书提示词库（作者累积的写作偏好与调整方向，请在本章创作时一并参考遵循）】\n${lines}\n（上述为作者对全书的持续性要求；与本章细纲、设定不冲突时应尽量落实，若有冲突则以细纲与设定为准。）`;
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

const SYSTEM_ARCHIVIST =
  "你是一位严谨的长篇小说连载叙事与设定管理员。你阅读刚完成的章节正文，抽取其中的关键事实与伏笔动向，用于维护全书的设定库与伏笔表。你的输出必须是严格合法的 JSON，不得包含任何多余解释、Markdown 代码块标记或注释。";

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

const SYSTEM_RECAP =
  "你是一位长篇小说连载的剧情梳理编辑。你阅读若干章节摘要或分卷概述，把它们归纳为连贯、不遗漏关键线索的滚动前情，供作者在后续章节创作时快速回顾，避免中后期记忆错乱。你只输出归纳后的正文段落，不得输出 JSON、标题、Markdown 标记或任何解释说明。";

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

const SYSTEM_RECONCILER =
  "你是一位严谨的长篇小说连载责任编辑，专职维护全书的前后一致性。作者刚刚重新生成了某一处内容，你需要审阅受其影响的下游内容（卷纲、后续章节脉络、章节摘要），只对确实与新内容产生矛盾或衔接不上的地方做最小必要的修订，使全书重新自洽。你的输出必须是严格合法的 JSON，不得包含任何多余解释、Markdown 代码块标记或注释。";

/**
 * After an upstream artifact is regenerated, review the downstream planning
 * artifacts and return only the targeted edits needed to keep the book
 * consistent, plus an author-facing summary of what changed. Never rewrites
 * prose — only flags chapters whose written prose may now conflict. Returns
 * JSON matching lib/reconcile.ReconcileResult.
 */
export function buildReconcilePrompt(
  change: ReconcileChange,
  payload: ReconcilePayload,
  bible: StoryBible | null
): ChatMessage[] {
  const originLabel =
    change.origin === "bible"
      ? "故事设定集（全书顶层设定）"
      : change.origin === "chapter-outline"
      ? "某一章的章节脉络"
      : "某一章的正文";
  const dir = (change.direction || "").trim()
    ? `\n本次调整方向（作者指定）：${change.direction!.trim()}`
    : "";
  const bibleRef = bible
    ? `\n【全书设定基准（仅供参考，勿修改）】\n${bibleBlock(bible)}\n`
    : "";
  const volLines = payload.volumes.length
    ? payload.volumes
        .map(
          (v) =>
            `- [volume id=${v.volumeId}] 第${v.index}卷「${v.title}」卷纲：${
              v.summary || "（暂无）"
            }`
        )
        .join("\n")
    : "（无）";
  const chapLines = payload.chapters.length
    ? payload.chapters
        .map(
          (c) =>
            `- [chapter id=${c.chapterId}] 第${c.global}章「${c.title}」` +
            `${c.hasContent ? "（已有正文）" : ""}\n` +
            `    脉络：${c.synopsis || "（暂无）"}\n` +
            `    摘要：${c.summary || "（暂无）"}`
        )
        .join("\n")
    : "（无）";
  return [
    { role: "system", content: SYSTEM_RECONCILER },
    {
      role: "user",
      content: `作者刚刚重新生成了${originLabel}。请据此对下游内容做一致性统一。

【本次改动】${change.label}
【改动后的权威内容（下游必须与之保持一致）】
${change.detail || "（未提供，请依据设定基准判断）"}${dir}
${bibleRef}
【受影响的卷纲】
${volLines}

【受影响的章节脉络与摘要（按顺序）】
${chapLines}

请审阅后输出如下结构的 JSON：
{
  "changeSummary": "用2-4句话面向作者说明：本次改了什么、为保持一致对下游做了哪些统一（若无需改动则说明原因）",
  "updates": [
    { "kind": "chapter-synopsis", "chapterId": "上面给出的对应 id", "value": "修订后的章节脉络" },
    { "kind": "chapter-summary", "chapterId": "对应 id", "value": "修订后的章节摘要" },
    { "kind": "chapter-title", "chapterId": "对应 id", "value": "修订后的标题" },
    { "kind": "volume-summary", "volumeId": "对应 id", "value": "修订后的卷纲" }
  ],
  "staleProse": [已有正文但因本次改动而可能前后矛盾、建议作者复核/重写的章节全局序号]
}

要求：
1. 只对确实与改动后内容矛盾、或衔接不上的条目做修订；无需改动的条目一律不要放进 updates。
2. id 必须原样照抄上面方括号中给出的 id，不得杜撰或改写；kind 必须是上述四种之一。
3. 修订要最小必要：保持原有的写作风格、篇幅与粒度，只改动受影响的部分，不要整体重写、不要扩写。
4. 绝对不要改写或输出任何章节正文；已有正文若与新内容冲突，只把其全局序号放入 staleProse，交由作者定夺。
5. 只输出 JSON。`,
    },
  ];
}

const SYSTEM_STYLE_ANALYST =
  "你是一位资深的文学评论家和写作教练。你的任务是精确分析给定文本的写作风格，并以严格的 JSON 格式输出“文风规则卡”。不要输出任何 JSON 以外的内容。";

/**
 * Analyze one text chunk across 7 stylistic dimensions. Returns JSON (snake_case)
 * that lib/style.ts normalizes and merges across chunks.
 */
export function buildStyleAnalyzePrompt(text: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_STYLE_ANALYST },
    {
      role: "user",
      content: `请阅读以下文本片段，从 7 个维度进行精确分析，并汇总为一条可执行的“模仿指南”，输出结构化的文风规则卡。分析必须严格基于下方给出的文本本身，不得自行想象或套用其他作品；若本片段为乱码、无意义字符或非小说正文，请将各字段置空。examples 内的例句必须“逐字”摘自下方文本片段，不得改写、翻译或虚构。

【分析维度】
1. 句式节奏：平均句长（字/句）、长短句比例、断句与标点使用习惯（如逗号碎句、短句堆叠、破折号/省略号偏好）
2. 词汇特征：10个高频特色词汇及其语体色彩（文言/口语/书面/网络）、三个禁用词。高频词与禁用词都只取能体现风格的实词（动词/形容词/副词/意象名词等），严禁包含人名、角色名、地名、称谓（如哥哥、姐姐、师父、老板等亲属或身份称呼）及其他专有名词
3. 描写策略：动作描写与心理描写的比例、感官细节使用偏好（视觉/听觉/触觉/嗅觉）
4. 对话风格：口语化程度（1-10分）、潜台词密度（高/中/低）、对话标签使用习惯
5. 叙事结构：叙事视角（第一/第三人称）、时间线处理方式（线性/插叙/倒叙）
6. 情绪基调：整体情绪色彩、情绪表达方式是“展示”还是“告知”
7. 修辞偏好：比喻/拟人/通感等修辞的使用频率和典型模式
最后，综合以上维度写一条“模仿指南”（signature）：用1-2句话概括“如何才能写出这种文风”的可执行要点，供后续模仿时直接遵循。

【输出格式】
严格输出以下 JSON 结构，不要添加任何额外字段或说明文字：

{
  "style_name": "风格名称（由你根据分析结果命名）",
  "signature": "模仿指南：1-2句可执行的风格复刻要点",
  "sentence_rhythm": { "avg_length": "平均句长（数字+字）", "pattern": "长短句节奏与标点断句特征描述", "examples": ["原文例句1", "原文例句2"] },
  "vocabulary": { "high_freq_words": ["共10个高频风格词，不得为人名/地名/称谓/专有名词"], "register": "语体色彩描述", "forbidden_words": ["词1（不得为人名/地名/称谓/专有名词）", "词2", "词3"] },
  "description_strategy": { "action_vs_psychology": "动作:心理 的比例", "sensory_preference": "感官偏好描述" },
  "dialogue_style": { "colloquial_score": 7, "subtext_density": "高/中/低", "tag_habit": "对话标签使用习惯描述" },
  "narrative_structure": { "perspective": "叙事视角", "timeline": "时间线处理方式" },
  "emotional_tone": { "tone": "情绪基调", "expression_mode": "展示/告知" },
  "rhetoric": { "preferred_types": ["修辞类型1", "修辞类型2"], "frequency": "高频/中频/低频", "examples": ["原文例句1"] }
}

【文本片段】
${text}`,
    },
  ];
}

const SYSTEM_ARCHIVE_ANALYST =
  "你是一位资深的小说设定与剧情分析师。你阅读给定的小说片段，抽取其世界观、人物、主线剧情与关键设定，用于为二创建立作品档案。你的输出必须是严格合法的 JSON，不得包含任何多余解释、Markdown 代码块标记或注释。";

/**
 * Analyze one text chunk for story-archive material (world/characters/plot).
 * Each chunk sees only part of the book; lib/archive.ts merges chunks into one
 * StoryArchive. Returns JSON (snake_case).
 */
export function buildArchiveAnalyzePrompt(text: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_ARCHIVE_ANALYST },
    {
      role: "user",
      content: `请阅读以下小说片段，抽取可用于二创的作品档案。本片段是一部长篇小说的其中一段（按阅读顺序切分），请只依据本片段实际出现的信息抽取，不要臆造、不要套用其他作品、也不要脑补本段之外的情节；人名、地名、事件必须是本片段中真实出现的。本片段未涉及的维度留空字符串或空数组；若本片段为乱码、目录、版权页或无意义字符，请将所有字段置空。

【抽取维度】
1. 作品名（若片段中可推断，否则留空）
2. 整体剧情概述（基于本片段可知的剧情）
3. 世界观设定：时代背景、地理、社会结构、核心设定
4. 力量体系 / 世界规则：修炼/魔法/科技等等级与规则（无则留空）
5. 核心主题与情感基调
6. 文风与叙事特色的简要提示
7. 主要人物：姓名、定位（主角/反派/重要配角）、别名、小传（身份/性格/目标/关系）
8. 关键地点与势力：名称与简介
9. 主线剧情脉络：按时序列出本片段中真实发生的关键事件（尽量完整覆盖本段情节推进，勿遗漏后半段）

【输出格式】
严格输出以下 JSON 结构，不要添加任何额外字段或说明文字：

{
  "title": "作品名（推断，无则留空）",
  "synopsis": "整体剧情概述",
  "worldbuilding": "世界观设定",
  "power_system": "力量体系 / 世界规则（无则留空）",
  "themes": "核心主题与情感基调",
  "style_hint": "文风与叙事特色提示",
  "characters": [ { "name": "人物名", "role": "主角/反派/重要配角", "aliases": ["别名"], "profile": "身份、性格、目标、关系" } ],
  "locations": [ { "name": "地点名", "note": "简介" } ],
  "factions": [ { "name": "势力名", "note": "简介" } ],
  "main_plot": ["按时序的关键剧情事件1", "事件2"]
}

【文本片段】
${text}`,
    },
  ];
}

const SYSTEM_ARCHIVE_REDUCER =
  "你是一位资深的小说设定与故事架构分析师。你会拿到从一部长篇小说各段落分别抽取的零散信息，需要把它们综合为对【整本书】连贯、准确的理解。你的输出必须是严格合法的 JSON，不得包含任何多余解释、Markdown 代码块标记或注释。";

/**
 * Second-pass "reduce": synthesize a coherent whole-book synopsis / worldbuilding
 * / themes and CONDENSE the scattered per-chunk plot points into a small set of
 * chapter/stage-level key beats. `material` is compiled by lib/archive.ts from
 * all per-chunk analyses. Returns JSON (snake_case).
 */
export function buildArchiveReducePrompt(material: string): ChatMessage[] {
  return [
    { role: "system", content: SYSTEM_ARCHIVE_REDUCER },
    {
      role: "user",
      content: `下面是从一部长篇小说的各个连续段落中分别抽取出的零散信息（按阅读顺序排列）。请综合全部信息，输出对【整本书】的统一理解，不要只依据某一段，也不要臆造素材中未提供的情节。

【要求】
1. synopsis：整体剧情概述，300到500字，讲清开端→发展→高潮→结局的主干与核心矛盾，体现作品真正的主题与基调，不要停留在开头。
2. worldbuilding：综合所有片段，给出连贯的世界观设定（时代背景、地理、社会结构、核心规则），去除重复与矛盾。
3. power_system：力量体系 / 世界规则（无则留空）。
4. themes：核心主题与情感基调。
5. style_hint：文风与叙事特色。
6. main_plot：把零散事件按阶段 / 章节归纳精炼为 8到16 条主线关键节点，每条概括一个阶段的核心冲突与推进，合并重复、剔除琐碎流水账，按时序排列。

【输出格式】
严格输出以下 JSON 结构，不要添加任何额外字段或说明文字：

{
  "synopsis": "整体剧情概述（300-500字）",
  "worldbuilding": "连贯的世界观设定",
  "power_system": "力量体系 / 世界规则（无则留空）",
  "themes": "核心主题与情感基调",
  "style_hint": "文风与叙事特色",
  "main_plot": ["阶段关键节点1", "阶段关键节点2"]
}

【待综合的素材】
${material}`,
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

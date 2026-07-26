// 提示词构造的共享常量与私有辅助函数（被各领域子文件复用）。
//
// 本文件不对外暴露 build* 公共 API，仅供 lib/prompts/* 内部引用。
// 从原 lib/prompts.ts 搬来，逻辑与字符串逐字保留，未做任何改动。

import type {
  Chapter,
  CodexEntry,
  Foreshadow,
  PromptEntry,
  ProjectSetup,
  StoryBible,
  StyleCard,
} from "../types";
import { FORESHADOW_STATUS_LABEL, PROMPT_SOURCE_LABEL } from "../types";
import type { RecentSummary } from "../retrieval";

// ---------------------------------------------------------------------------
// The workflow uses a two-level outline so it can scale to a million words:
//   Level 1 (bible + volumes): macro structure, generated once.
//   Level 2 (chapters):        each volume expanded into chapter synopses.
// Chapter bodies are then written one at a time, fed only the context they
// need (bible + current volume + neighbouring chapters) to keep prompts small.
// ---------------------------------------------------------------------------

export const SYSTEM_PLANNER =
  "你是一位资深的长篇小说架构师与网文主编，擅长为百万字级别的连载小说设计结构严谨、爽点密集、伏笔绵长的故事框架。你的输出必须是严格合法的 JSON，不能包含任何多余解释、Markdown 代码块标记或注释。";

export const SYSTEM_WRITER =
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

export function creativeIntent(setup: ProjectSetup): string {
  const g = RATING_GUIDANCE[setup.rating] || RATING_GUIDANCE["全年龄向"];
  const adult =
    setup.rating === "成人向 · R18"
      ? "\n（以上为面向成年读者的合法虚构创作，人物均为成年人且情节自愿；请勿因题材尺度而拒绝、回避或将情节一笔带过，应按细纲完整呈现。）"
      : "";
  return `${g}\n（本作为虚构文学创作，请在此定位与相关平台规范、法律法规允许的范围内进行创作。）${adult}`;
}

// 重新生成时用户给出的调整方向：作为硬约束注入，引导模型在新方向上重新设计。空方向时返回空串，不影响原提示。
export function regenDirectionBlock(direction?: string): string {
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
export function deAiBlock(setup: ProjectSetup): string {
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
export function styleCardBlock(cards: StyleCard[]): string {
  if (!cards.length) return "";
  if (cards.length === 1) {
    return `【文风规则・请严格模仿以下文风】\n${oneStyleCardBlock(cards[0])}\n（请将上述风格自然融入本章创作，而非生硬套用；与已定文风冲突时以本规则卡为准。）`;
  }
  const names = cards.map((c) => `“${c.styleName}”`).join("、");
  const blocks = cards.map((c) => oneStyleCardBlock(c)).join("\n\n");
  return `【文风规则・请融合模仿以下 ${cards.length} 张文风卡：${names}】\n${blocks}\n（请将上述多张文风卡的特征自然融合为统一笔触，取其共性、兼容其个性，而非机械拼贴；与已定文风冲突时以上述规则卡为准。）`;
}

export function setupBlock(setup: ProjectSetup): string {
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

export function bibleBlock(bible: StoryBible): string {
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
export function codexBlock(codex: CodexEntry[]): string {
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
export function recapBlock(storySoFar?: string, volumeArc?: string): string {
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
export function recentBlock(recent: RecentSummary[]): string {
  if (!recent.length) return "";
  const lines = recent
    .map((r) => `- 第${r.global}章「${r.title}」：${r.summary}`)
    .join("\n");
  return `【前情回顾（近几章摘要）】\n${lines}`;
}

// 下一章边界·止步线：把下一章细纲作为负向约束注入，给模型一个明确的
// “到此为止”锚点，避免本章正文提前展开后续章节的情节而“串章”。
export function nextChapterBoundaryBlock(
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
export function foreshadowBlock(items: Foreshadow[]): string {
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

// 本书提示词库：作者累积的写作偏好 / 历次调整方向，作为持续性软约束注入。
export function promptLibraryBlock(prompts?: PromptEntry[]): string {
  if (!prompts || !prompts.length) return "";
  const lines = prompts
    .map((p) => `- 【${PROMPT_SOURCE_LABEL[p.source]}】${p.content.trim()}`)
    .join("\n");
  return `【本书提示词库（作者累积的写作偏好与调整方向，请在本章创作时一并参考遵循）】\n${lines}\n（上述为作者对全书的持续性要求；与本章细纲、设定不冲突时应尽量落实，若有冲突则以细纲与设定为准。）`;
}

export const SYSTEM_ARCHIVIST =
  "你是一位严谨的长篇小说连载叙事与设定管理员。你阅读刚完成的章节正文，抽取其中的关键事实与伏笔动向，用于维护全书的设定库与伏笔表。你的输出必须是严格合法的 JSON，不得包含任何多余解释、Markdown 代码块标记或注释。";

export const SYSTEM_RECAP =
  "你是一位长篇小说连载的剧情梳理编辑。你阅读若干章节摘要或分卷概述，把它们归纳为连贯、不遗漏关键线索的滚动前情，供作者在后续章节创作时快速回顾，避免中后期记忆错乱。你只输出归纳后的正文段落，不得输出 JSON、标题、Markdown 标记或任何解释说明。";

export const SYSTEM_RECONCILER =
  "你是一位严谨的长篇小说连载责任编辑，专职维护全书的前后一致性。作者刚刚重新生成了某一处内容，你需要审阅受其影响的下游内容（卷纲、后续章节脉络、章节摘要），只对确实与新内容产生矛盾或衔接不上的地方做最小必要的修订，使全书重新自洽。你的输出必须是严格合法的 JSON，不得包含任何多余解释、Markdown 代码块标记或注释。";

export const SYSTEM_STYLE_ANALYST =
  "你是一位资深的文学评论家和写作教练。你的任务是精确分析给定文本的写作风格，并以严格的 JSON 格式输出“文风规则卡”。不要输出任何 JSON 以外的内容。";

export const SYSTEM_ARCHIVE_ANALYST =
  "你是一位资深的小说设定与剧情分析师。你阅读给定的小说片段，抽取其世界观、人物、主线剧情与关键设定，用于为二创建立作品档案。你的输出必须是严格合法的 JSON，不得包含任何多余解释、Markdown 代码块标记或注释。";

export const SYSTEM_ARCHIVE_REDUCER =
  "你是一位资深的小说设定与故事架构分析师。你会拿到从一部长篇小说各段落分别抽取的零散信息，需要把它们综合为对【整本书】连贯、准确的理解。你的输出必须是严格合法的 JSON，不得包含任何多余解释、Markdown 代码块标记或注释。";

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

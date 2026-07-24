// Core data model for the novel-generation workflow.
// A Project moves through two phases:
//   1. Outline  -> a "story bible" plus a hierarchical volume/chapter map
//   2. Writing  -> chapter bodies generated against that map
// Everything is persisted as a single JSON file per project on the server.

export type ChapterStatus = "empty" | "draft" | "done";

export interface Character {
  name: string;
  role: string; // 主角 / 反派 / 配角 ...
  profile: string; // 一句话人物小传
}

export interface StoryBible {
  logline: string; // 一句话故事内核
  synopsis: string; // 整体故事梗概
  worldbuilding: string; // 世界观 / 设定
  themes: string; // 核心主题与情感基调
  tone: string; // 文风、叙事视角
  characters: Character[];
}

export interface Chapter {
  id: string;
  index: number; // 卷内序号，从 1 开始
  title: string;
  synopsis: string; // 本章要点（来自大纲）
  content: string; // 正文
  summary: string; // 本章成稿后的精炼摘要（用于跨章续写时的“前情”，避免上下文爆炸）
  wordCount: number;
  status: ChapterStatus;
  updatedAt: number;
}

// 信息库条目：随剧情增长、可检索的“世界档案”，解决百万字跨卷失忆问题。
export type CodexCategory =
  | "人物"
  | "地点"
  | "物品"
  | "势力"
  | "设定"
  | "其他";

export const CODEX_CATEGORIES: CodexCategory[] = [
  "人物",
  "地点",
  "物品",
  "势力",
  "设定",
  "其他",
];

// 设定条目的一次状态变更（章节锚定），构成实体的“状态时间线”，
// 让百万字里的人物/势力演变有据可查，避免“死而复生”“位置回退”等记忆错乱。
export interface CodexEvent {
  chapter: number; // 发生变化的全局章号
  note: string; // 该章此实体发生的关键变化（一句话）
}

export interface CodexEntry {
  id: string;
  category: CodexCategory;
  name: string; // 主名称
  aliases: string[]; // 别名/绰号（用于检索命中）
  summary: string; // 当前状态与关键信息（最新快照）
  updatedAtChapter: number; // 最后更新于第几章（全局序号，0=大纲阶段）
  status?: string; // 当前存续状态（人物/势力常用，如 存活/死亡/失踪/未知），用于硬约束
  pinned?: boolean; // 核心条目：检索时恒定注入（主角/关键设定），不受子串命中限制
  events?: CodexEvent[]; // 状态变化时间线（按章追加）
}

// 伏笔线索：埋设→强化→回收的全生命周期跟踪。
export type ForeshadowStatus = "planted" | "reinforced" | "paid" | "abandoned";

export const FORESHADOW_STATUS_LABEL: Record<ForeshadowStatus, string> = {
  planted: "已埋设",
  reinforced: "已强化",
  paid: "已回收",
  abandoned: "已废弃",
};

export interface Foreshadow {
  id: string;
  title: string; // 伏笔简述
  detail: string; // 具体内容 / 线索
  status: ForeshadowStatus;
  plantedAt: number; // 埋设章节（全局序号，0=尚未埋设/计划中）
  payoffPlan: string; // 计划如何回收
  paidAt: number; // 回收章节（0=未回收）
}

export interface Volume {
  id: string;
  index: number; // 卷序号，从 1 开始
  title: string;
  summary: string; // 本卷主线概述
  plannedChapters: number; // 大纲阶段规划的章节数（用于尚未展开时的目标）
  chapters: Chapter[];
  arcSummary?: string; // 本卷已完成部分的滚动摘要（分层记忆的卷级）
}

// 提示词库：每本书专属的、可累积复用的写作偏好 / 调整方向集合。
// 每次带方向的重新生成会自动记入，作者也可主动编辑；后续正文生成时一并参考。
export type PromptSource =
  | "manual" // 主动编辑
  | "bible" // 来源于故事设定集重新生成
  | "volumes" // 来源于分卷脉络重新生成
  | "chapter-outline" // 来源于章节脉络重新生成
  | "prose"; // 来源于正文重写

export const PROMPT_SOURCE_LABEL: Record<PromptSource, string> = {
  manual: "主动编辑",
  bible: "来源于故事设定集",
  volumes: "来源于分卷脉络",
  "chapter-outline": "来源于章节脉络",
  prose: "来源于正文",
};

export interface PromptEntry {
  id: string;
  source: PromptSource;
  content: string; // 提示词 / 调整方向文本
  note: string; // 上下文备注（如“第12章”），可空
  enabled: boolean; // 是否在后续生成时参考
  createdAt: number;
}

// 文风规则卡：由「拆书学文风」分析生成，可导出复用，也可注入某部作品的写作提示词。
export interface StyleCard {
  id: string;
  sourceFileHash: string; // 源文件内容哈希（用于缓存去重）
  sourceFileName: string;
  createdAt: number;
  styleName: string; // 风格名称（模型命名）
  signature: string; // 模仿指南：一句可执行的风格复刻要点（综合各维度得出）
  sentenceRhythm: { avgLength: string; pattern: string; examples: string[] };
  vocabulary: { highFreqWords: string[]; register: string; forbiddenWords: string[] };
  descriptionStrategy: { actionVsPsychology: string; sensoryPreference: string };
  dialogueStyle: { colloquialScore: number; subtextDensity: string; tagHabit: string };
  narrativeStructure: { perspective: string; timeline: string };
  emotionalTone: { tone: string; expressionMode: string };
  rhetoric: { preferredTypes: string[]; frequency: string; examples: string[] };
}

// 作品档案卡：由「拆书学设定」分析生成，抽取一本书的世界观/人物/主线剧情等，
// 用于「二创开新书」：一键新建作品并把档案填入故事圣经与设定库。
export interface ArchiveCharacter {
  name: string;
  role: string; // 主角 / 反派 / 重要配角 ...
  aliases: string[]; // 别名/称号
  profile: string; // 身份、性格、目标、关系
}

export interface ArchiveEntry {
  name: string;
  note: string; // 简介
}

export interface StoryArchive {
  id: string;
  sourceFileHash: string; // 源文件内容哈希（缓存去重）
  sourceFileName: string;
  createdAt: number;
  title: string; // 推断的作品名
  synopsis: string; // 整体剧情概述
  worldbuilding: string; // 世界观设定
  powerSystem: string; // 力量体系 / 世界规则
  themes: string; // 核心主题与基调
  styleHint: string; // 文风与叙事特色提示
  characters: ArchiveCharacter[];
  locations: ArchiveEntry[]; // 关键地点
  factions: ArchiveEntry[]; // 势力
  mainPlot: string[]; // 主线剧情脉络（按时序的关键事件）
}

export interface ProjectSetup {
  genre: string; // 题材，例如 "东方玄幻"
  premise: string; // 一句话灵感 / 核心设定
  protagonist: string; // 主角设定
  style: string; // 期望文风
  rating: string; // 题材基调 / 内容分级
  targetWords: number; // 目标总字数
  wordsPerChapter: number; // 单章目标字数
  targetChapters: number; // 预设全书总章节数（0=依据目标字数自动规划）
  targetVolumes: number; // 预设分卷数（脉络段数，0=自动推算）
  deAi: boolean; // 是否启用“去 AI 味”增强
  bannedList: string; // 负面清单：必须回避的词语 / 句式 / 桥段（换行分隔）
  styleCard: StyleCard | null; // 已应用的文风规则卡（旧版单张，兼容保留；null=未应用）
  styleCards: StyleCard[]; // 已应用的多张文风卡（多选，非空时优先于单张 styleCard）
  extra: string; // 其他要求
}

// 内容分级选项（用于向模型声明创作意图，减少正常虚构剧情被误判）
export const RATING_OPTIONS = [
  "全年龄向",
  "青年向",
  "成人向 · 严肃文学",
  "成人向 · R18",
] as const;

export type ProjectPhase = "setup" | "outline" | "writing";

export interface Project {
  id: string;
  title: string;
  phase: ProjectPhase;
  setup: ProjectSetup;
  bible: StoryBible | null;
  volumes: Volume[];
  codex: CodexEntry[]; // 信息库 / 世界档案
  foreshadows: Foreshadow[]; // 伏笔线索表
  prompts: PromptEntry[]; // 提示词库（写作偏好 / 历次调整方向）
  storySoFar?: string; // 已完成分卷的全书故事梗概（分层记忆顶层，弥合中期断层）
  createdAt: number;
  updatedAt: number;
}

export interface ProjectSummary {
  id: string;
  title: string;
  phase: ProjectPhase;
  genre: string;
  totalWords: number;
  chapterCount: number;
  doneCount: number;
  updatedAt: number;
}

export interface ApiConfig {
  baseUrl: string; // 例如 https://api.deepseek.com/v1
  apiKey: string;
  model: string; // 例如 deepseek-chat
  temperature: number;
}

export const DEFAULT_SETUP: ProjectSetup = {
  genre: "",
  premise: "",
  protagonist: "",
  style: "",
  rating: "全年龄向",
  targetWords: 1_000_000,
  wordsPerChapter: 2500,
  targetChapters: 0,
  targetVolumes: 0,
  deAi: true,
  bannedList: "",
  styleCard: null,
  styleCards: [],
  extra: "",
};

export function emptyProject(id: string, title: string): Project {
  const now = Date.now();
  return {
    id,
    title,
    phase: "setup",
    setup: { ...DEFAULT_SETUP },
    bible: null,
    volumes: [],
    codex: [],
    foreshadows: [],
    prompts: [],
    createdAt: now,
    updatedAt: now,
  };
}

// 生成正文时实际参考的文风卡集合：优先用多选的 styleCards，回退到旧版单张 styleCard。
export function effectiveStyleCards(setup: ProjectSetup): StyleCard[] {
  if (setup.styleCards && setup.styleCards.length) return setup.styleCards;
  return setup.styleCard ? [setup.styleCard] : [];
}

export function countWords(text: string): number {
  if (!text) return 0;
  // 去掉空白后按字符计（中文以字计），近似字数统计
  return text.replace(/\s+/g, "").length;
}

// 提示词库：记录一条提示词。自动去重——同来源同内容不重复堆积，仅置顶并刷新时间。
// 内容为空则原样返回（无方向的重新生成不产生条目）。返回新的 Project（纯函数）。
export function recordPromptEntry(
  project: Project,
  source: PromptSource,
  content: string,
  note = ""
): Project {
  const text = (content || "").trim();
  if (!text) return project;
  const prompts = project.prompts || [];
  const existing = prompts.find(
    (p) => p.source === source && p.content.trim() === text
  );
  if (existing) {
    return {
      ...project,
      prompts: [
        { ...existing, note: note || existing.note, createdAt: Date.now() },
        ...prompts.filter((p) => p.id !== existing.id),
      ],
    };
  }
  const entry: PromptEntry = {
    id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    source,
    content: text,
    note,
    enabled: true,
    createdAt: Date.now(),
  };
  return { ...project, prompts: [entry, ...prompts] };
}

// 后续生成时应参考的提示词（已启用且非空）。
export function enabledPrompts(project: Project): PromptEntry[] {
  return (project.prompts || []).filter((p) => p.enabled && p.content.trim());
}

export function projectStats(p: Project) {
  let totalWords = 0;
  let chapterCount = 0;
  let doneCount = 0;
  for (const v of p.volumes) {
    for (const c of v.chapters) {
      chapterCount += 1;
      totalWords += c.wordCount;
      if (c.status === "done") doneCount += 1;
    }
  }
  return { totalWords, chapterCount, doneCount };
}

export function toSummary(p: Project): ProjectSummary {
  const { totalWords, chapterCount, doneCount } = projectStats(p);
  return {
    id: p.id,
    title: p.title,
    phase: p.phase,
    genre: p.setup.genre,
    totalWords,
    chapterCount,
    doneCount,
    updatedAt: p.updatedAt,
  };
}

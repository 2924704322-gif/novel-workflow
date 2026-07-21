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

export interface CodexEntry {
  id: string;
  category: CodexCategory;
  name: string; // 主名称
  aliases: string[]; // 别名/绰号（用于检索命中）
  summary: string; // 当前状态与关键信息
  updatedAtChapter: number; // 最后更新于第几章（全局序号，0=大纲阶段）
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
  deAi: boolean; // 是否启用“去 AI 味”增强
  bannedList: string; // 负面清单：必须回避的词语 / 句式 / 桥段（换行分隔）
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
  deAi: true,
  bannedList: "",
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
    createdAt: now,
    updatedAt: now,
  };
}

export function countWords(text: string): number {
  if (!text) return 0;
  // 去掉空白后按字符计（中文以字计），近似字数统计
  return text.replace(/\s+/g, "").length;
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

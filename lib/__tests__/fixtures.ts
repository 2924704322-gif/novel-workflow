// 测试公共 fixture：构造内存中的极简 Project，避免读取 data/ 真实文件。
// 本文件不是 *.test.ts，不会被 vitest 收集为测试用例。
import {
  emptyProject,
  type Chapter,
  type CodexEntry,
  type Foreshadow,
  type Project,
  type Volume,
} from "../types";

function chapter(
  id: string,
  index: number,
  title: string,
  summary = ""
): Chapter {
  return {
    id,
    index,
    title,
    synopsis: "",
    content: "",
    summary,
    wordCount: 0,
    status: summary ? "done" : "empty",
    updatedAt: 0,
  };
}

/**
 * 构造一个包含两卷、核心角色、信息库与伏笔的测试工程。
 * - 卷一 v1：c1、c2（各带摘要，用于前情检索）
 * - 卷二 v2：c4（目标章，用于 buildChapterContext）
 * - 核心角色「林惊蛰」pinned，恒注入
 * - 伏笔：fs1(planted) 与 fs2(paid)，activeForeshadows 只取 planted
 */
export function makeProject(): Project {
  const p = emptyProject("p1", "测试之书");
  p.bible = {
    logline: "故事内核",
    synopsis: "整体梗概",
    worldbuilding: "",
    themes: "",
    tone: "",
    characters: [{ name: "林惊蛰", role: "主角", profile: "测试主角" }],
  };
  const v1: Volume = {
    id: "v1",
    index: 1,
    title: "第一卷",
    summary: "",
    plannedChapters: 3,
    chapters: [chapter("c1", 1, "第一章", "第一章摘要"), chapter("c2", 2, "第二章", "第二章摘要")],
  };
  const v2: Volume = {
    id: "v2",
    index: 2,
    title: "第二卷",
    summary: "卷二概述",
    plannedChapters: 1,
    chapters: [chapter("c4", 1, "第四章", "")],
  };
  p.volumes = [v1, v2];
  p.codex = [
    {
      id: "kx1",
      category: "人物",
      name: "林惊蛰",
      aliases: [],
      summary: "主角",
      updatedAtChapter: 0,
      pinned: true,
      events: [],
    },
  ] as CodexEntry[];
  p.foreshadows = [
    {
      id: "fs1",
      title: "剑冢之谜",
      detail: "",
      status: "planted",
      plantedAt: 1,
      payoffPlan: "",
      paidAt: 0,
    },
    {
      id: "fs2",
      title: "旧伏笔",
      detail: "",
      status: "paid",
      plantedAt: 1,
      payoffPlan: "",
      paidAt: 1,
    },
  ] as Foreshadow[];
  return p;
}

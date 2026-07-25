// 任务队列 —— 预置任务模板。
//
// 复用现有 Skill 定义，快速构建常用批量任务。

import type { TaskDefinition } from "./types";

function stepId(): string {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * 批量续写：为指定章节列表逐一生成正文。
 */
export function batchWriteChapters(
  projectId: string,
  chapterIds: string[]
): TaskDefinition {
  return {
    name: `批量续写 ${chapterIds.length} 章`,
    projectId,
    steps: chapterIds.map((chapterId) => ({
      id: stepId(),
      skillId: "write-chapter",
      skillParams: { projectId, chapterId },
    })),
  };
}

/**
 * 批量摘要：为指定章节列表逐一生成摘要。
 */
export function batchDigest(
  projectId: string,
  chapterIds: string[]
): TaskDefinition {
  return {
    name: `批量摘要 ${chapterIds.length} 章`,
    projectId,
    steps: chapterIds.map((chapterId) => ({
      id: stepId(),
      skillId: "write-and-digest",
      skillParams: { projectId, chapterId },
    })),
  };
}

/**
 * 全卷流水线：对指定卷的所有章节依次续写。
 */
export function fullPipeline(
  projectId: string,
  volumeIndex: number,
  chapterIds: string[]
): TaskDefinition {
  return {
    name: `全卷流水线 第${volumeIndex + 1}卷（${chapterIds.length} 章）`,
    projectId,
    steps: chapterIds.map((chapterId) => ({
      id: stepId(),
      skillId: "write-chapter",
      skillParams: { projectId, chapterId },
    })),
  };
}

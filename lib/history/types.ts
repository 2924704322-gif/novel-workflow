// 章节版本历史 —— 类型定义。
//
// 每次 save_project apply 落库前，自动对被修改章节拍快照。
// 支持 diff 对比和一键回滚。

import type { Chapter } from "../types";

/** 快照触发来源。 */
export type SnapshotSource = "agent" | "manual" | "rollback";

/** 章节快照完整数据。 */
export interface ChapterSnapshot {
  id: string; // 时间戳 based ID
  projectId: string;
  volumeIndex: number; // 所在卷序号（0-based）
  chapterId: string;
  chapter: Chapter; // 快照时的完整章节副本
  createdAt: number;
  source: SnapshotSource;
}

/** 快照列表的精简元数据（不含正文）。 */
export interface SnapshotMeta {
  id: string;
  projectId: string;
  chapterId: string;
  volumeIndex: number;
  wordCount: number;
  status: string;
  createdAt: number;
  source: SnapshotSource;
}

/** diff 行变更类型。 */
export type DiffLineType = "equal" | "add" | "delete";

/** 单行 diff 结果。 */
export interface DiffLine {
  type: DiffLineType;
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

/** 两版本间的差异结果。 */
export interface DiffResult {
  lines: DiffLine[];
  addedCount: number;
  deletedCount: number;
  unchangedCount: number;
}

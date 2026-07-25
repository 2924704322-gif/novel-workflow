// 章节版本历史 —— 快照存储（文件系统实现）。
//
// 路径：data/history/{projectId}/{chapterId}/{timestamp}.json
// 保留策略：每章最多 50 个快照，超出时删最旧的。

import { promises as fs } from "fs";
import path from "path";
import { dataRoot } from "../storage";
import type { Chapter } from "../types";
import type { ChapterSnapshot, SnapshotMeta, SnapshotSource } from "./types";

const MAX_SNAPSHOTS_PER_CHAPTER = 50;

function historyDir(): string {
  return path.join(dataRoot(), "history");
}

function chapterDir(projectId: string, chapterId: string): string {
  return path.join(historyDir(), safeId(projectId), safeId(chapterId));
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

function generateSnapshotId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 保存章节快照。落库前调用。
 */
export async function saveSnapshot(
  projectId: string,
  chapterId: string,
  volumeIndex: number,
  chapter: Chapter,
  source: SnapshotSource = "agent"
): Promise<ChapterSnapshot> {
  const dir = chapterDir(projectId, chapterId);
  await fs.mkdir(dir, { recursive: true });

  const snapshot: ChapterSnapshot = {
    id: generateSnapshotId(),
    projectId,
    volumeIndex,
    chapterId,
    chapter: { ...chapter },
    createdAt: Date.now(),
    source,
  };

  await fs.writeFile(
    path.join(dir, `${snapshot.id}.json`),
    JSON.stringify(snapshot, null, 2),
    "utf-8"
  );

  // 保留策略：超出上限时删除最旧的
  await enforceRetentionLimit(dir);

  return snapshot;
}

/**
 * 列出某章的所有快照元数据（按时间降序）。
 */
export async function listSnapshots(
  projectId: string,
  chapterId: string
): Promise<SnapshotMeta[]> {
  const dir = chapterDir(projectId, chapterId);
  try {
    const files = await fs.readdir(dir);
    const metas: SnapshotMeta[] = [];

    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      try {
        const raw = await fs.readFile(path.join(dir, f), "utf-8");
        const s = JSON.parse(raw) as ChapterSnapshot;
        metas.push({
          id: s.id,
          projectId: s.projectId,
          chapterId: s.chapterId,
          volumeIndex: s.volumeIndex,
          wordCount: s.chapter.wordCount,
          status: s.chapter.status,
          createdAt: s.createdAt,
          source: s.source,
        });
      } catch {
        /* skip corrupted */
      }
    }

    metas.sort((a, b) => b.createdAt - a.createdAt);
    return metas;
  } catch {
    return [];
  }
}

/**
 * 获取完整快照数据。
 */
export async function getSnapshot(
  projectId: string,
  chapterId: string,
  snapshotId: string
): Promise<ChapterSnapshot | null> {
  const filePath = path.join(
    chapterDir(projectId, chapterId),
    `${safeId(snapshotId)}.json`
  );
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw) as ChapterSnapshot;
  } catch {
    return null;
  }
}

/**
 * 回滚：将快照中的章节数据还原到作品中。
 * 返回被还原的 Chapter 数据，由调用方负责写回 project。
 */
export async function getSnapshotForRestore(
  projectId: string,
  chapterId: string,
  snapshotId: string
): Promise<Chapter | null> {
  const snapshot = await getSnapshot(projectId, chapterId, snapshotId);
  if (!snapshot) return null;
  return snapshot.chapter;
}

// ---- 内部 ----

async function enforceRetentionLimit(dir: string): Promise<void> {
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));
    if (jsonFiles.length <= MAX_SNAPSHOTS_PER_CHAPTER) return;

    // 按文件名排序（时间戳 base36 前缀，天然有序）
    const sorted = jsonFiles.sort();
    const toDelete = sorted.slice(0, sorted.length - MAX_SNAPSHOTS_PER_CHAPTER);
    for (const f of toDelete) {
      await fs.unlink(path.join(dir, f));
    }
  } catch {
    /* best effort */
  }
}

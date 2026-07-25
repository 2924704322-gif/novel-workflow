import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { projectRepository } from "@/lib/repository";
import { listSnapshots, getSnapshot, getSnapshotForRestore, saveSnapshot } from "@/lib/history/store";
import { diffChapters } from "@/lib/history/diff";

export const dynamic = "force-dynamic";

// GET /api/history?projectId=xxx&chapterId=yyy — 列出快照
// GET /api/history?projectId=xxx&chapterId=yyy&snapshotId=zzz — 获取完整快照
// GET /api/history?projectId=xxx&chapterId=yyy&snapshotId=zzz&diff=true — diff 对比当前版本
export async function GET(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const { searchParams } = new URL(req.url);
  const projectId = searchParams.get("projectId");
  const chapterId = searchParams.get("chapterId");
  const snapshotId = searchParams.get("snapshotId");
  const diffMode = searchParams.get("diff") === "true";

  if (!projectId || !chapterId) {
    return NextResponse.json({ error: "需要 projectId 和 chapterId" }, { status: 400 });
  }

  // 列出快照
  if (!snapshotId) {
    const metas = await listSnapshots(projectId, chapterId);
    return NextResponse.json(metas);
  }

  // 获取完整快照
  const snapshot = await getSnapshot(projectId, chapterId, snapshotId);
  if (!snapshot) {
    return NextResponse.json({ error: "快照不存在" }, { status: 404 });
  }

  // diff 模式：与当前版本对比
  if (diffMode) {
    const project = await projectRepository.get(ownerId, projectId);
    if (!project) {
      return NextResponse.json({ error: "作品不存在" }, { status: 404 });
    }
    let currentContent = "";
    for (const v of project.volumes) {
      const ch = v.chapters.find((c) => c.id === chapterId);
      if (ch) {
        currentContent = ch.content || "";
        break;
      }
    }
    const result = diffChapters(snapshot.chapter.content || "", currentContent);
    return NextResponse.json({ snapshot, diff: result });
  }

  return NextResponse.json(snapshot);
}

// POST /api/history — 回滚到指定快照
// body: { projectId, chapterId, snapshotId }
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const body = await req.json().catch(() => ({}));
  const { projectId, chapterId, snapshotId } = body as {
    projectId?: string;
    chapterId?: string;
    snapshotId?: string;
  };

  if (!projectId || !chapterId || !snapshotId) {
    return NextResponse.json(
      { error: "需要 projectId、chapterId 和 snapshotId" },
      { status: 400 }
    );
  }

  const restoredChapter = await getSnapshotForRestore(projectId, chapterId, snapshotId);
  if (!restoredChapter) {
    return NextResponse.json({ error: "快照不存在" }, { status: 404 });
  }

  const project = await projectRepository.get(ownerId, projectId);
  if (!project) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }

  // 找到章节并替换，先对当前版本拍快照
  let found = false;
  for (let vi = 0; vi < project.volumes.length; vi++) {
    const v = project.volumes[vi];
    const ci = v.chapters.findIndex((c) => c.id === chapterId);
    if (ci >= 0) {
      // 回滚前先保存当前状态为快照
      await saveSnapshot(projectId, chapterId, vi, v.chapters[ci], "rollback");
      // 还原
      v.chapters[ci] = { ...restoredChapter, updatedAt: Date.now() };
      found = true;
      break;
    }
  }

  if (!found) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }

  project.updatedAt = Date.now();
  await projectRepository.save(ownerId, project);

  return NextResponse.json({ success: true, chapter: restoredChapter });
}

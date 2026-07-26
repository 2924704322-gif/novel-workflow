import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { getEffectiveConfig } from "@/lib/config-provider";
import { enqueueTask, listTasks, deleteTask, getTask } from "@/lib/queue/store";
import { startTask, pauseTask } from "@/lib/queue/runner";
import type { TaskDefinition } from "@/lib/queue/types";

export const dynamic = "force-dynamic";

// GET /api/queue — 列出所有任务
export async function GET(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const tasks = await listTasks(ownerId);
  return NextResponse.json(tasks);
}

// POST /api/queue — 操作：enqueue / start / pause / delete
// body: { action, ...payload }
export async function POST(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const body = await req.json().catch(() => ({}));
  const action = body.action as string;

  switch (action) {
    case "enqueue": {
      const def = body.task as TaskDefinition;
      if (!def || !def.name || !def.projectId || !def.steps?.length) {
        return NextResponse.json({ error: "缺少 task 定义" }, { status: 400 });
      }
      const task = await enqueueTask(ownerId, def);
      return NextResponse.json(task, { status: 201 });
    }

    case "start": {
      const taskId = body.taskId as string;
      if (!taskId) {
        return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });
      }
      const task = await getTask(taskId);
      if (!task) {
        return NextResponse.json({ error: "任务不存在" }, { status: 404 });
      }
      // 优先采用入队时固化的配置；未固化时退回调用方携带的 body.config。
      const config = getEffectiveConfig(task.config || body.config);
      // 后台启动（不阻塞请求）
      const controller = new AbortController();
      startTask(taskId, { config, signal: controller.signal }).catch(() => {});
      return NextResponse.json({ started: true, taskId });
    }

    case "pause": {
      const taskId = body.taskId as string;
      if (!taskId) {
        return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });
      }
      const task = await pauseTask(taskId);
      return NextResponse.json(task || { error: "任务不存在或非运行中" });
    }

    case "delete": {
      const taskId = body.taskId as string;
      if (!taskId) {
        return NextResponse.json({ error: "缺少 taskId" }, { status: 400 });
      }
      const ok = await deleteTask(taskId);
      return NextResponse.json({ deleted: ok });
    }

    default:
      return NextResponse.json(
        { error: `未知操作：${action}，可选 enqueue/start/pause/delete` },
        { status: 400 }
      );
  }
}

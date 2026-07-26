// 任务队列 —— 持久化存储（文件系统实现）。
//
// 路径：data/queue/{taskId}.json

import { promises as fs } from "fs";
import path from "path";
import { dataRoot } from "../storage";
import type { TaskRun, TaskDefinition } from "./types";

function queueDir(): string {
  return path.join(dataRoot(), "queue");
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "");
}

function generateId(): string {
  return `task-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 入队：创建新任务。
 */
export async function enqueueTask(
  ownerId: string,
  def: TaskDefinition
): Promise<TaskRun> {
  const dir = queueDir();
  await fs.mkdir(dir, { recursive: true });

  const task: TaskRun = {
    id: generateId(),
    ownerId,
    projectId: def.projectId,
    name: def.name,
    steps: def.steps.map((s) => ({
      ...s,
      status: "pending" as const,
    })),
    status: "pending",
    currentStep: 0,
    retries: 0,
    maxRetries: def.maxRetries ?? 3,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    // 固化入队时生效配置，供 start 时优先采用。
    config: def.config,
  };

  await fs.writeFile(
    path.join(dir, `${task.id}.json`),
    JSON.stringify(task, null, 2),
    "utf-8"
  );
  return task;
}

/**
 * 获取单个任务。
 */
export async function getTask(taskId: string): Promise<TaskRun | null> {
  try {
    const raw = await fs.readFile(
      path.join(queueDir(), `${safeId(taskId)}.json`),
      "utf-8"
    );
    return JSON.parse(raw) as TaskRun;
  } catch {
    return null;
  }
}

/**
 * 列出所有任务（按更新时间降序）。
 */
export async function listTasks(ownerId?: string): Promise<TaskRun[]> {
  const dir = queueDir();
  await fs.mkdir(dir, { recursive: true });
  const files = await fs.readdir(dir);
  const tasks: TaskRun[] = [];

  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const t = JSON.parse(
        await fs.readFile(path.join(dir, f), "utf-8")
      ) as TaskRun;
      if (!ownerId || t.ownerId === ownerId) {
        tasks.push(t);
      }
    } catch {
      /* skip */
    }
  }

  tasks.sort((a, b) => b.updatedAt - a.updatedAt);
  return tasks;
}

/**
 * 更新任务（部分字段）。
 */
export async function updateTask(
  taskId: string,
  patch: Partial<TaskRun>
): Promise<TaskRun | null> {
  const task = await getTask(taskId);
  if (!task) return null;

  const updated: TaskRun = { ...task, ...patch, id: task.id, updatedAt: Date.now() };
  await fs.writeFile(
    path.join(queueDir(), `${safeId(taskId)}.json`),
    JSON.stringify(updated, null, 2),
    "utf-8"
  );
  return updated;
}

/**
 * 删除任务。
 */
export async function deleteTask(taskId: string): Promise<boolean> {
  try {
    await fs.unlink(path.join(queueDir(), `${safeId(taskId)}.json`));
    return true;
  } catch {
    return false;
  }
}

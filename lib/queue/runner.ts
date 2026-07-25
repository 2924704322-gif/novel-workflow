// 任务队列 —— 执行器（TaskRunner）。
//
// 从第一个未完成 step 开始执行，每步完成后持久化 checkpoint，
// 失败时指数退避重试，超出上限则标记失败。
// 与 Agent runtime 集成：内部调用 runAgentTurn() 执行 skill 模式，
// 队列模式下自动 approve（用户入队时已一次性授权）。

import type { ApiConfig } from "../types";
import type { TaskRun, QueueEvent } from "./types";
import { getTask, updateTask } from "./store";
import { runAgentTurn, type RuntimeContext } from "../agent/runtime";
import type { AgentChatRequest, AgentStreamEvent } from "../agent/types";

export type QueueEventCallback = (event: QueueEvent) => void;

interface RunnerOptions {
  config: ApiConfig;
  onEvent?: QueueEventCallback;
  signal?: AbortSignal;
}

/**
 * 执行任务队列。从当前 step 开始逐步执行。
 * 支持暂停（通过 signal abort）和断点恢复（再次调用 start 即从上次中断处继续）。
 */
export async function startTask(
  taskId: string,
  options: RunnerOptions
): Promise<TaskRun | null> {
  let task = await getTask(taskId);
  if (!task) return null;
  if (task.status === "done" || task.status === "failed") return task;

  task = (await updateTask(taskId, { status: "running" }))!;

  const rt: RuntimeContext = { ownerId: task.ownerId };

  for (let i = task.currentStep; i < task.steps.length; i++) {
    if (options.signal?.aborted) {
      await updateTask(taskId, { status: "paused", currentStep: i });
      options.onEvent?.({ type: "task_paused", taskId });
      return getTask(taskId);
    }

    const step = task.steps[i];
    step.status = "running";
    step.startedAt = Date.now();
    await updateTask(taskId, { steps: task.steps, currentStep: i });
    options.onEvent?.({ type: "step_start", taskId, stepIndex: i, stepId: step.id });

    let success = false;
    let lastError = "";

    for (let attempt = 0; attempt <= task.maxRetries; attempt++) {
      if (options.signal?.aborted) break;

      try {
        const result = await executeStep(task, step, options.config, rt, options.signal);
        step.status = "done";
        step.result = result;
        step.completedAt = Date.now();
        task.retries = 0;
        await updateTask(taskId, { steps: task.steps, retries: 0 });
        options.onEvent?.({ type: "step_done", taskId, stepIndex: i, result });
        success = true;
        break;
      } catch (err) {
        lastError = (err as Error).message || "未知错误";
        const willRetry = attempt < task.maxRetries;
        options.onEvent?.({
          type: "step_failed",
          taskId,
          stepIndex: i,
          error: lastError,
          willRetry,
        });

        if (willRetry) {
          // 指数退避：1s, 2s, 4s
          const delay = Math.pow(2, attempt) * 1000;
          await sleep(delay);
        }
      }
    }

    if (!success) {
      step.status = "failed";
      step.error = lastError;
      await updateTask(taskId, {
        steps: task.steps,
        status: "failed",
        error: `步骤 ${i + 1}/${task.steps.length} 失败：${lastError}`,
        currentStep: i,
      });
      options.onEvent?.({ type: "task_failed", taskId, error: lastError });
      return getTask(taskId);
    }
  }

  // 全部完成
  await updateTask(taskId, {
    status: "done",
    completedAt: Date.now(),
    currentStep: task.steps.length,
  });
  options.onEvent?.({ type: "task_done", taskId });
  return getTask(taskId);
}

/**
 * 暂停任务（设置状态，runner 循环下次检查时会跳出）。
 */
export async function pauseTask(taskId: string): Promise<TaskRun | null> {
  const task = await getTask(taskId);
  if (!task || task.status !== "running") return task;
  return updateTask(taskId, { status: "paused" });
}

// ---- 内部 ----

async function executeStep(
  task: TaskRun,
  step: { skillId: string; skillParams: Record<string, any> },
  config: ApiConfig,
  rt: RuntimeContext,
  signal?: AbortSignal
): Promise<any> {
  // 构建一个 skill 模式的 AgentChatRequest
  const req: AgentChatRequest = {
    config,
    messages: [],
    projectId: task.projectId,
    skillId: step.skillId,
    skillParams: step.skillParams,
  };

  let proposalId: string | null = null;
  let textAccum = "";

  // 第一轮：执行 skill
  const gen = runAgentTurn(req, rt, signal);
  for await (const event of gen) {
    if (event.type === "text") {
      textAccum += event.delta;
    } else if (event.type === "proposal") {
      proposalId = (event as any).proposal?.id;
    } else if (event.type === "error") {
      throw new Error((event as any).message);
    }
  }

  // 自动确认（队列模式）
  if (proposalId) {
    const confirmReq: AgentChatRequest = {
      config,
      messages: [],
      projectId: task.projectId,
      confirmations: [{ proposalId, approved: true }],
    };
    const confirmGen = runAgentTurn(confirmReq, rt, signal);
    for await (const event of confirmGen) {
      if (event.type === "error") {
        throw new Error((event as any).message);
      }
    }
  }

  return { proposalId, textLength: textAccum.length };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

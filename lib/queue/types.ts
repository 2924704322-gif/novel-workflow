// 任务队列 —— 类型定义。
//
// 将长任务（批量续写、批量摘要等）分解为 step 序列，入队后逐步执行，
// 支持失败重试和从上次成功 step 恢复。

export type TaskStatus = "pending" | "running" | "paused" | "done" | "failed";
export type StepStatus = "pending" | "running" | "done" | "failed";

export interface TaskStep {
  id: string;
  skillId: string; // 复用现有 Skill 定义
  skillParams: Record<string, any>;
  status: StepStatus;
  result?: any; // step 产出（如 proposalId / 字数统计）
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskRun {
  id: string;
  ownerId: string;
  projectId: string;
  name: string; // 如 "批量续写 卷一 第3-8章"
  steps: TaskStep[];
  status: TaskStatus;
  currentStep: number; // 当前执行到第几步（0-based）
  retries: number; // 当前 step 已重试次数
  maxRetries: number; // 默认 3
  error?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
}

/** 创建任务时的输入。 */
export interface TaskDefinition {
  name: string;
  projectId: string;
  steps: Omit<TaskStep, "status" | "startedAt" | "completedAt" | "result" | "error">[];
  maxRetries?: number;
}

/** 任务进度事件（SSE 推送）。 */
export type QueueEvent =
  | { type: "step_start"; taskId: string; stepIndex: number; stepId: string }
  | { type: "step_done"; taskId: string; stepIndex: number; result: any }
  | { type: "step_failed"; taskId: string; stepIndex: number; error: string; willRetry: boolean }
  | { type: "task_done"; taskId: string }
  | { type: "task_failed"; taskId: string; error: string }
  | { type: "task_paused"; taskId: string };

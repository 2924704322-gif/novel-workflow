"use client";

import { useState, useEffect, useCallback } from "react";
import type { TaskRun } from "@/lib/queue/types";

interface TaskQueueProps {
  projectId?: string;
}

const STATUS_LABEL: Record<string, { text: string; color: string }> = {
  pending: { text: "等待中", color: "text-neutral-400" },
  running: { text: "执行中", color: "text-blue-400" },
  paused: { text: "已暂停", color: "text-yellow-400" },
  done: { text: "已完成", color: "text-green-400" },
  failed: { text: "失败", color: "text-red-400" },
};

export default function TaskQueue({ projectId }: TaskQueueProps) {
  const [tasks, setTasks] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchTasks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/queue");
      if (res.ok) {
        let all: TaskRun[] = await res.json();
        if (projectId) {
          all = all.filter((t) => t.projectId === projectId);
        }
        setTasks(all);
      }
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    fetchTasks();
    // 轮询运行中任务状态
    const interval = setInterval(fetchTasks, 5000);
    return () => clearInterval(interval);
  }, [fetchTasks]);

  const handleAction = async (action: string, taskId: string) => {
    const config = (() => {
      try {
        return JSON.parse(localStorage.getItem("p.config") || "{}");
      } catch {
        return {};
      }
    })();

    await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, taskId, config }),
    });
    await fetchTasks();
  };

  const progress = (task: TaskRun) => {
    const done = task.steps.filter((s) => s.status === "done").length;
    return `${done}/${task.steps.length}`;
  };

  const progressPct = (task: TaskRun) => {
    const done = task.steps.filter((s) => s.status === "done").length;
    return Math.round((done / task.steps.length) * 100);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700">
        <h3 className="font-medium text-neutral-200">任务队列</h3>
        <button
          onClick={fetchTasks}
          className="text-xs text-neutral-400 hover:text-neutral-200"
        >
          刷新
        </button>
      </div>

      {loading && tasks.length === 0 ? (
        <div className="p-4 text-center text-neutral-500">加载中...</div>
      ) : tasks.length === 0 ? (
        <div className="p-4 text-center text-neutral-500">暂无任务</div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          {tasks.map((task) => {
            const status = STATUS_LABEL[task.status] || STATUS_LABEL.pending;
            return (
              <div
                key={task.id}
                className="px-3 py-2.5 border-b border-neutral-700/50 hover:bg-neutral-700/30"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-neutral-200 font-medium truncate max-w-[180px]">
                    {task.name}
                  </span>
                  <span className={`text-xs ${status.color}`}>{status.text}</span>
                </div>

                {/* 进度条 */}
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="flex-1 h-1.5 bg-neutral-700 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        task.status === "failed"
                          ? "bg-red-500"
                          : task.status === "done"
                          ? "bg-green-500"
                          : "bg-blue-500"
                      }`}
                      style={{ width: `${progressPct(task)}%` }}
                    />
                  </div>
                  <span className="text-xs text-neutral-500 w-10 text-right">
                    {progress(task)}
                  </span>
                </div>

                {/* 信息行 */}
                <div className="flex items-center justify-between">
                  <span className="text-xs text-neutral-500">
                    {formatTime(task.updatedAt)}
                    {task.error && (
                      <span className="ml-2 text-red-400" title={task.error}>
                        {task.error.slice(0, 30)}...
                      </span>
                    )}
                  </span>

                  {/* 操作按钮 */}
                  <div className="flex gap-1.5">
                    {(task.status === "pending" || task.status === "paused") && (
                      <button
                        onClick={() => handleAction("start", task.id)}
                        className="px-1.5 py-0.5 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white"
                      >
                        {task.status === "paused" ? "继续" : "开始"}
                      </button>
                    )}
                    {task.status === "running" && (
                      <button
                        onClick={() => handleAction("pause", task.id)}
                        className="px-1.5 py-0.5 text-xs rounded bg-yellow-700 hover:bg-yellow-600 text-white"
                      >
                        暂停
                      </button>
                    )}
                    {task.status === "failed" && (
                      <button
                        onClick={() => handleAction("start", task.id)}
                        className="px-1.5 py-0.5 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white"
                      >
                        重试
                      </button>
                    )}
                    {(task.status === "done" || task.status === "failed") && (
                      <button
                        onClick={() => handleAction("delete", task.id)}
                        className="px-1.5 py-0.5 text-xs rounded bg-neutral-600 hover:bg-neutral-500 text-neutral-300"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

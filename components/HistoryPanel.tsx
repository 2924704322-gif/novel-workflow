"use client";

import { useState, useEffect, useCallback } from "react";
import type { SnapshotMeta, DiffResult, DiffLine } from "@/lib/history/types";

interface HistoryPanelProps {
  projectId: string;
  chapterId: string;
  onRestore?: () => void; // 回滚成功后的回调（刷新章节内容）
}

export default function HistoryPanel({ projectId, chapterId, onRestore }: HistoryPanelProps) {
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [diff, setDiff] = useState<DiffResult | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);

  const fetchSnapshots = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/history?projectId=${projectId}&chapterId=${chapterId}`
      );
      if (res.ok) {
        setSnapshots(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [projectId, chapterId]);

  useEffect(() => {
    fetchSnapshots();
  }, [fetchSnapshots]);

  const handleSelect = async (snapshotId: string) => {
    setSelectedId(snapshotId);
    setDiffLoading(true);
    setDiff(null);
    try {
      const res = await fetch(
        `/api/history?projectId=${projectId}&chapterId=${chapterId}&snapshotId=${snapshotId}&diff=true`
      );
      if (res.ok) {
        const data = await res.json();
        setDiff(data.diff);
      }
    } finally {
      setDiffLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedId) return;
    if (!confirm("确定要回滚到此版本吗？当前内容将被保存为新快照。")) return;
    setRestoring(true);
    try {
      const res = await fetch("/api/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, chapterId, snapshotId: selectedId }),
      });
      if (res.ok) {
        await fetchSnapshots();
        setSelectedId(null);
        setDiff(null);
        onRestore?.();
      }
    } finally {
      setRestoring(false);
    }
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const sourceLabel: Record<string, string> = {
    agent: "AI 生成",
    manual: "手动编辑",
    rollback: "回滚",
  };

  return (
    <div className="flex flex-col h-full text-sm">
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700">
        <h3 className="font-medium text-neutral-200">版本历史</h3>
        <span className="text-xs text-neutral-500">{snapshots.length} 个快照</span>
      </div>

      {loading ? (
        <div className="p-4 text-center text-neutral-500">加载中...</div>
      ) : snapshots.length === 0 ? (
        <div className="p-4 text-center text-neutral-500">暂无历史快照</div>
      ) : (
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* 快照列表 */}
          <div className="flex-shrink-0 max-h-48 overflow-y-auto border-b border-neutral-700">
            {snapshots.map((s) => (
              <button
                key={s.id}
                onClick={() => handleSelect(s.id)}
                className={`w-full text-left px-3 py-2 hover:bg-neutral-700/50 transition-colors ${
                  selectedId === s.id ? "bg-neutral-700" : ""
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-neutral-300">{formatTime(s.createdAt)}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-neutral-600 text-neutral-300">
                    {sourceLabel[s.source] || s.source}
                  </span>
                </div>
                <div className="text-xs text-neutral-500 mt-0.5">
                  {s.wordCount} 字 · {s.status}
                </div>
              </button>
            ))}
          </div>

          {/* Diff 视图 */}
          {selectedId && (
            <div className="flex-1 overflow-y-auto">
              {diffLoading ? (
                <div className="p-4 text-center text-neutral-500">加载差异...</div>
              ) : diff ? (
                <div className="p-2">
                  <div className="flex items-center justify-between mb-2 px-1">
                    <span className="text-xs text-neutral-400">
                      <span className="text-green-400">+{diff.addedCount}</span>{" "}
                      <span className="text-red-400">-{diff.deletedCount}</span>{" "}
                      <span className="text-neutral-500">={diff.unchangedCount}</span>
                    </span>
                    <button
                      onClick={handleRestore}
                      disabled={restoring}
                      className="px-2 py-1 text-xs rounded bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-50"
                    >
                      {restoring ? "回滚中..." : "回滚到此版本"}
                    </button>
                  </div>
                  <div className="font-mono text-xs leading-5 bg-neutral-900 rounded p-2 max-h-64 overflow-y-auto">
                    {diff.lines.slice(0, 200).map((line: DiffLine, i: number) => (
                      <div
                        key={i}
                        className={`${
                          line.type === "add"
                            ? "bg-green-900/30 text-green-300"
                            : line.type === "delete"
                            ? "bg-red-900/30 text-red-300"
                            : "text-neutral-500"
                        }`}
                      >
                        <span className="inline-block w-4 text-right mr-1 opacity-50">
                          {line.type === "add" ? "+" : line.type === "delete" ? "-" : " "}
                        </span>
                        {line.content || " "}
                      </div>
                    ))}
                    {diff.lines.length > 200 && (
                      <div className="text-neutral-500 mt-1">
                        ... 还有 {diff.lines.length - 200} 行
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

"use client";

// 版本历史（FT-11 救火：统一清爽风，Q1）
// 仅用清爽风主层令牌（app/globals.css），清除 Tailwind 暗色类与暖阁硬编码暖色。
// 保持原有功能逻辑（快照列表 / diff 对比 / 回滚），只替换视觉层与令牌引用。

import { useState, useEffect, useCallback } from "react";
import type { SnapshotMeta, DiffResult, DiffLine } from "@/lib/history/types";
import { X, Clock } from "@/components/studio/icons";
import EmptyState from "@/components/studio/EmptyState";

interface HistoryPanelProps {
  projectId: string;
  chapterId: string;
  onRestore?: () => void; // 回滚成功后的回调（刷新章节内容）
  /** FT-11：挂载为模态时提供关闭按钮。 */
  onClose?: () => void;
}

export default function HistoryPanel({
  projectId,
  chapterId,
  onRestore,
  onClose,
}: HistoryPanelProps) {
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
    return `${d.getMonth() + 1}/${d.getDate()} ${d
      .getHours()
      .toString()
      .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  const sourceLabel: Record<string, string> = {
    agent: "AI 生成",
    manual: "手动编辑",
    rollback: "回滚",
  };

  return (
    <div className="tray-root">
      <div className="tray-head">
        <div>
          <span className="tray-title">版本历史</span>
          <span className="tray-sub">{snapshots.length} 个快照</span>
        </div>
        {onClose && (
          <button
            type="button"
            className="modal-x"
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={16} />
          </button>
        )}
      </div>

      {loading ? (
        <div className="tray-empty">加载中...</div>
      ) : snapshots.length === 0 ? (
        <EmptyState
          icon={<Clock size={20} />}
          title="暂无历史快照"
          hint="本章每次落稿会自动拍快照，回滚到此前的版本。"
        />
      ) : (
        <div className="tray-body history-split">
          {/* 快照列表 */}
          <div className="snap-list">
            {snapshots.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => handleSelect(s.id)}
                className={"snap-item" + (selectedId === s.id ? " on" : "")}
              >
                <div className="snap-row-top">
                  <span className="snap-time">{formatTime(s.createdAt)}</span>
                  <span className="tag">{sourceLabel[s.source] || s.source}</span>
                </div>
                <div className="task-meta">
                  {s.wordCount} 字 · {s.status}
                </div>
              </button>
            ))}
          </div>

          {/* Diff 视图 */}
          {selectedId && (
            <div className="snap-diff">
              {diffLoading ? (
                <div className="tray-empty">加载差异...</div>
              ) : diff ? (
                <div>
                  <div className="diff-head">
                    <span className="diff-counts">
                      <span className="st-jade">+{diff.addedCount}</span>{" "}
                      <span className="st-danger">-{diff.deletedCount}</span>{" "}
                      <span className="st-faint">={diff.unchangedCount}</span>
                    </span>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      onClick={handleRestore}
                      disabled={restoring}
                    >
                      {restoring ? "回滚中..." : "回滚到此版本"}
                    </button>
                  </div>
                  <div className="diff">
                    {diff.lines.slice(0, 200).map((line: DiffLine, i: number) => (
                      <div
                        key={i}
                        className={
                          line.type === "add"
                            ? "diff-add"
                            : line.type === "delete"
                              ? "diff-del"
                              : "diff-eq"
                        }
                      >
                        <span className="diff-mark">
                          {line.type === "add"
                            ? "+"
                            : line.type === "delete"
                              ? "-"
                              : " "}
                        </span>
                        {line.content || " "}
                      </div>
                    ))}
                    {diff.lines.length > 200 && (
                      <div className="diff-eq">
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

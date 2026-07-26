"use client";

// 任务队列（FT-11 救火：统一清爽风，Q1）
// 仅用清爽风主层令牌（app/globals.css），清除 Tailwind 暗色类与暖阁硬编码暖色。
// 保持原有功能逻辑（任务队列轮询 / 入队表单 / 启停删），只替换视觉层与令牌引用。

import { useState, useEffect, useCallback } from "react";
import type { TaskRun, TaskDefinition } from "@/lib/queue/types";
import type { Project, ProjectSummary, Volume } from "@/lib/types";
import { loadConfig, fetchProjects, fetchProject } from "@/lib/client";
import { batchWriteChapters, batchDigest, fullPipeline } from "@/lib/queue/presets";
import { X, Layers } from "@/components/studio/icons";
import EmptyState from "@/components/studio/EmptyState";

interface TaskQueueProps {
  projectId?: string;
  /** FT-11：挂载为模态时提供关闭按钮。 */
  onClose?: () => void;
}

const STATUS_TEXT: Record<string, string> = {
  pending: "等待中",
  running: "执行中",
  paused: "已暂停",
  done: "已完成",
  failed: "失败",
};
const STATUS_CLZ: Record<string, string> = {
  pending: "st-faint",
  running: "st-accent",
  paused: "st-amber",
  done: "st-jade",
  failed: "st-danger",
};
const STATUS_BAR: Record<string, string> = {
  pending: "",
  running: "",
  paused: "",
  done: "done",
  failed: "failed",
};

type PresetKind = "write" | "digest" | "pipeline";

const PRESET_LABEL: Record<PresetKind, string> = {
  write: "批量续写（write-chapter）",
  digest: "批量摘要（write-and-digest）",
  pipeline: "全卷流水线（write-chapter）",
};

export default function TaskQueue({ projectId, onClose }: TaskQueueProps) {
  const [tasks, setTasks] = useState<TaskRun[]>([]);
  const [loading, setLoading] = useState(false);

  // ---- 入队表单状态 ----
  const [showForm, setShowForm] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selProjectId, setSelProjectId] = useState<string>(projectId || "");
  const [detail, setDetail] = useState<Project | null>(null);
  const [selVolumeId, setSelVolumeId] = useState<string>("");
  const [preset, setPreset] = useState<PresetKind>("write");
  const [fromIdx, setFromIdx] = useState<string>("");
  const [toIdx, setToIdx] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [formErr, setFormErr] = useState<string>("");

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

  // projectId 由外部注入时，自动加载该作品以选取卷/章节。
  useEffect(() => {
    if (projectId) {
      setSelProjectId(projectId);
      fetchProject(projectId)
        .then((p) => setDetail(p))
        .catch(() => setDetail(null));
    }
  }, [projectId]);

  // 打开表单时，若没有外部 projectId，则拉取作品列表供选择。
  const openForm = useCallback(async () => {
    setShowForm(true);
    setFormErr("");
    if (!projectId) {
      try {
        const ps = await fetchProjects();
        setProjects(ps);
      } catch {
        setProjects([]);
      }
    }
  }, [projectId]);

  const onSelectProject = useCallback(async (pid: string) => {
    setSelProjectId(pid);
    setSelVolumeId("");
    setDetail(null);
    if (pid) {
      try {
        const p = await fetchProject(pid);
        setDetail(p);
      } catch {
        setDetail(null);
      }
    }
  }, []);

  const selectedVolume: Volume | null = detail
    ? detail.volumes.find((v) => v.id === selVolumeId) || null
    : null;

  const handleAction = async (action: string, taskId: string) => {
    // P0-1 修复：配置真源是 client.ts 的 loadConfig()（active profile），
    // 不再读取不存在的 p.config。start 时服务端优先采用任务固化 config，
    // 此处仍附带一份作为兜底。
    const config = loadConfig();

    await fetch("/api/queue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, taskId, config }),
    });
    await fetchTasks();
  };

  // 提交入队：按所选预设 + 卷/章节范围构建 TaskDefinition，并固化当前生效配置。
  const submitEnqueue = async () => {
    setFormErr("");
    if (!selProjectId) {
      setFormErr("请先选择作品。");
      return;
    }
    if (!selectedVolume) {
      setFormErr("请选择目标卷。");
      return;
    }

    const from = Number(fromIdx);
    const to = Number(toIdx);
    let chs = selectedVolume.chapters;
    if (!Number.isNaN(from) && from > 0) chs = chs.filter((c) => c.index >= from);
    if (!Number.isNaN(to) && to > 0) chs = chs.filter((c) => c.index <= to);

    const chapterIds = chs.map((c) => c.id);
    if (chapterIds.length === 0) {
      setFormErr("该卷在当前范围内没有可选章节，请调整起止序号。");
      return;
    }

    const def: TaskDefinition =
      preset === "write"
        ? batchWriteChapters(selProjectId, chapterIds)
        : preset === "digest"
          ? batchDigest(selProjectId, chapterIds)
          : fullPipeline(selProjectId, selectedVolume.index - 1, chapterIds);

    setSubmitting(true);
    try {
      // 固化当前生效配置（loadConfig() = active profile），随任务一起写入，
      // 这样 start 时无需客户端再取、也避免入队/开始两端配置不一致。
      const taskWithConfig: TaskDefinition = { ...def, config: loadConfig() };
      const res = await fetch("/api/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "enqueue", task: taskWithConfig }),
      });
      if (!res.ok) {
        const e = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(e.error || "入队失败");
      }
      setShowForm(false);
      setSelVolumeId("");
      setFromIdx("");
      setToIdx("");
      await fetchTasks();
    } catch (err) {
      setFormErr(err instanceof Error ? err.message : "入队失败");
    } finally {
      setSubmitting(false);
    }
  };

  const progress = (task: TaskRun) => {
    const done = task.steps.filter((s) => s.status === "done").length;
    return `${done}/${task.steps.length}`;
  };

  const progressPct = (task: TaskRun) => {
    const done = task.steps.filter((s) => s.status === "done").length;
    return task.steps.length === 0
      ? 0
      : Math.round((done / task.steps.length) * 100);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getMonth() + 1}/${d.getDate()} ${d
      .getHours()
      .toString()
      .padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
  };

  return (
    <div className="tray-root">
      <div className="tray-head">
        <span className="tray-title">任务队列</span>
        <div className="tray-head-actions">
          {!showForm && (
            <button type="button" className="link-btn" onClick={openForm}>
              + 新建批量任务
            </button>
          )}
          <button type="button" className="link-btn" onClick={fetchTasks}>
            刷新
          </button>
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
      </div>

      {/* 入队表单（最小可用） */}
      {showForm && (
        <div className="tray-section">
          <div className="tray-label" style={{ marginBottom: 8 }}>
            新建批量任务
          </div>

          {!projectId && (
            <div className="tray-field">
              <label className="tray-label">作品</label>
              <select
                className="control"
                value={selProjectId}
                onChange={(e) => onSelectProject(e.target.value)}
              >
                <option value="">— 选择作品 —</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="tray-field">
            <label className="tray-label">预设</label>
            <select
              className="control"
              value={preset}
              onChange={(e) => setPreset(e.target.value as PresetKind)}
            >
              {(Object.keys(PRESET_LABEL) as PresetKind[]).map((k) => (
                <option key={k} value={k}>
                  {PRESET_LABEL[k]}
                </option>
              ))}
            </select>
          </div>

          <div className="tray-field">
            <label className="tray-label">目标卷</label>
            <select
              className="control"
              value={selVolumeId}
              onChange={(e) => setSelVolumeId(e.target.value)}
              disabled={!detail}
            >
              <option value="">— 选择卷 —</option>
              {detail?.volumes.map((v) => (
                <option key={v.id} value={v.id}>
                  第{v.index}卷 · {v.title}（{v.chapters.length} 章）
                </option>
              ))}
            </select>
          </div>

          <div className="tray-field">
            <div style={{ display: "flex", gap: 8 }}>
              <div style={{ flex: 1 }}>
                <label className="tray-label">起始章号</label>
                <input
                  className="control"
                  value={fromIdx}
                  onChange={(e) => setFromIdx(e.target.value)}
                  placeholder="1"
                  inputMode="numeric"
                />
              </div>
              <div style={{ flex: 1 }}>
                <label className="tray-label">结束章号</label>
                <input
                  className="control"
                  value={toIdx}
                  onChange={(e) => setToIdx(e.target.value)}
                  placeholder="全部"
                  inputMode="numeric"
                />
              </div>
            </div>
          </div>

          {formErr && (
            <div className="st-danger" style={{ fontSize: 12 }}>
              {formErr}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button
              type="button"
              className="btn-primary btn-sm"
              style={{ flex: 1 }}
              onClick={submitEnqueue}
              disabled={submitting}
            >
              {submitting ? "提交中…" : "加入队列"}
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => {
                setShowForm(false);
                setFormErr("");
              }}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {loading && tasks.length === 0 ? (
        <div className="tray-empty">加载中...</div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={<Layers size={20} />}
          title="暂无任务"
          hint="新建一个批量续写 / 摘要 / 流水线任务，跑长任务不占用对话。"
        />
      ) : (
        <div className="tray-body">
          {tasks.map((task) => {
            const status = STATUS_TEXT[task.status] || STATUS_TEXT.pending;
            const statusClz = STATUS_CLZ[task.status] || STATUS_CLZ.pending;
            const barClz = STATUS_BAR[task.status] || "";
            return (
              <div key={task.id} className="task-row">
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 6,
                  }}
                >
                  <span className="task-name">{task.name}</span>
                  <span className={statusClz} style={{ fontSize: 12 }}>
                    {status}
                  </span>
                </div>

                {/* 进度条 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 6,
                  }}
                >
                  <div className={"task-bar " + barClz}>
                    <span style={{ width: `${progressPct(task)}%` }} />
                  </div>
                  <span
                    className="task-meta"
                    style={{ width: 40, textAlign: "right" }}
                  >
                    {progress(task)}
                  </span>
                </div>

                {/* 信息行 */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <span className="task-meta">
                    {formatTime(task.updatedAt)}
                    {task.error && (
                      <span
                        className="st-danger"
                        style={{ marginLeft: 8 }}
                        title={task.error}
                      >
                        {task.error.slice(0, 30)}…
                      </span>
                    )}
                  </span>

                  {/* 操作按钮 */}
                  <div style={{ display: "flex", gap: 6 }}>
                    {(task.status === "pending" || task.status === "paused") && (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => handleAction("start", task.id)}
                      >
                        {task.status === "paused" ? "继续" : "开始"}
                      </button>
                    )}
                    {task.status === "running" && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => handleAction("pause", task.id)}
                      >
                        暂停
                      </button>
                    )}
                    {task.status === "failed" && (
                      <button
                        type="button"
                        className="btn-primary btn-sm"
                        onClick={() => handleAction("start", task.id)}
                      >
                        重试
                      </button>
                    )}
                    {(task.status === "done" || task.status === "failed") && (
                      <button
                        type="button"
                        className="btn-ghost btn-sm"
                        onClick={() => handleAction("delete", task.id)}
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

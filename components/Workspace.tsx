"use client";

// DEPRECATED（Q6 废弃）：拆除独立工作台路由，其能力（大纲 two-step / 正文 writing /
// 角色对话）全部并入中栏对话系统。当前已无人 import（/project/[id] 重定向到 Studio）。
// 保留文件仅供历史参考，请勿在新代码中 import。
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import StepOutline from "@/components/StepOutline";
import StepWriting from "@/components/StepWriting";
import { fetchProject, formatWords, saveProjectRemote } from "@/lib/client";
import { projectStats, type Project } from "@/lib/types";

type Step = 1 | 2;

export default function Workspace({ id }: { id: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [step, setStep] = useState<Step>(1);
  // 书名就地编辑（工作区顶部）：点「改名」切换为输入框，回车/失焦保存。
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">(
    "idle"
  );
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Project | null>(null);

  useEffect(() => {
    fetchProject(id).then((p) => {
      if (!p) return setNotFound(true);
      setProject(p);
      latest.current = p;
      setStep(p.phase === "writing" ? 2 : 1);
    });
  }, [id]);

  const flush = useCallback(async () => {
    if (!latest.current) return;
    setSaveState("saving");
    await saveProjectRemote(latest.current);
    setSaveState("saved");
  }, []);

  // Update project state and debounce a save to the server.
  const patch = useCallback(
    (updater: (p: Project) => Project) => {
      setProject((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        latest.current = next;
        setSaveState("saving");
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(flush, 900);
        return next;
      });
    },
    [flush]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        // 卸载前若仍有未落盘的改动（防抖窗口未到），立即补存一次，
        // 避免用户在 900ms 内离开工作区时丢失正文等改动。
        void flush();
      }
    };
  }, [flush]);

  if (notFound) {
    return (
      <>
        <main className="shell" style={{ paddingTop: 80, textAlign: "center" }}>
          <p className="muted">这部作品不存在或已被删除。</p>
          <Link href="/" className="btn btn--ghost" style={{ marginTop: 16 }}>
            返回书房
          </Link>
        </main>
      </>
    );
  }

  if (!project) {
    return (
      <>
        <main className="shell" style={{ paddingTop: 80, textAlign: "center" }}>
          <p className="faint">正在展开书卷…</p>
        </main>
      </>
    );
  }

  const stats = projectStats(project);
  const hasBible = Boolean(project.bible);
  const progress =
    project.setup.targetWords > 0
      ? Math.min(100, (stats.totalWords / project.setup.targetWords) * 100)
      : 0;

  return (
    <>
      {/* Work header with steps + progress */}
      <div style={{ borderBottom: "1px solid var(--line)" }}>
        <div className="shell" style={{ paddingTop: 22, paddingBottom: 20 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <Link href="/" className="faint" style={{ fontSize: 13 }}>
              ← 书房
            </Link>
            {editingTitle ? (
              <input
                className="input"
                autoFocus
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
                onBlur={() => {
                  const t = titleDraft.trim();
                  if (t && t !== project.title) {
                    patch((p) => ({ ...p, title: t }));
                  }
                  setEditingTitle(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                  if (e.key === "Escape") setEditingTitle(false);
                }}
                style={{
                  fontSize: 22,
                  maxWidth: 360,
                  fontFamily: "var(--font-serif)",
                }}
                placeholder="输入书名"
              />
            ) : (
              <>
                <h1 style={{ fontSize: 26 }}>{project.title}</h1>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    setTitleDraft(project.title);
                    setEditingTitle(true);
                  }}
                  title="修改书名"
                >
                  改名
                </button>
              </>
            )}
            {project.setup.genre && (
              <span className="chip">{project.setup.genre}</span>
            )}
            <span
              className="faint"
              style={{ marginLeft: "auto", fontSize: 12, minWidth: 52, textAlign: "right" }}
            >
              {saveState === "saving"
                ? "保存中…"
                : saveState === "saved"
                ? "已保存"
                : ""}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 24,
              marginTop: 18,
              flexWrap: "wrap",
            }}
          >
            <StepTab
              n={1}
              label="立意 · 大纲"
              active={step === 1}
              onClick={() => setStep(1)}
            />
            <div
              style={{
                flex: "0 0 40px",
                height: 1,
                background: "var(--line-strong)",
              }}
            />
            <StepTab
              n={2}
              label="铺陈 · 正文"
              active={step === 2}
              disabled={!hasBible}
              onClick={() => hasBible && setStep(2)}
            />

            <div style={{ marginLeft: "auto", minWidth: 220 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12,
                  marginBottom: 6,
                }}
                className="faint"
              >
                <span>
                  {formatWords(stats.totalWords)} /{" "}
                  {formatWords(project.setup.targetWords)}
                </span>
                <span>
                  {stats.doneCount}/{stats.chapterCount} 章
                </span>
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 6,
                  background: "var(--ink-700)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${progress}%`,
                    height: "100%",
                    background:
                      "linear-gradient(90deg, var(--cinnabar-deep), var(--cinnabar-bright))",
                    transition: "width .4s ease",
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {step === 1 ? (
        <StepOutline project={project} patch={patch} goWriting={() => setStep(2)} />
      ) : (
        <StepWriting project={project} patch={patch} flush={flush} />
      )}
    </>
  );
}

function StepTab({
  n,
  label,
  active,
  disabled,
  onClick,
}: {
  n: number;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "none",
        border: "none",
        padding: 0,
        opacity: disabled ? 0.4 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
      }}
    >
      <span
        className="seal seal--sm"
        style={{
          background: active
            ? undefined
            : "var(--ink-700)",
          color: active ? undefined : "var(--fg-dim)",
          boxShadow: active ? undefined : "0 0 0 1px var(--line-strong) inset",
        }}
      >
        {n}
      </span>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 16,
          color: active ? "var(--fg)" : "var(--fg-dim)",
        }}
      >
        {label}
      </span>
    </button>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { loadConfig, streamPost, formatWords } from "@/lib/client";
import { countWords, type Chapter, type Project, type Volume } from "@/lib/types";
import {
  activeForeshadows,
  applyDigest,
  buildChapterContext,
  type ChapterDigest,
} from "@/lib/retrieval";
import { CodexPanel, ForeshadowPanel } from "./CodexPanel";

type PanelMode = "prose" | "codex" | "foreshadow";

interface FlatChapter {
  chapter: Chapter;
  volume: Volume;
  prev: Chapter | null;
  global: number;
}

export default function StepWriting({
  project,
  patch,
  flush,
}: {
  project: Project;
  patch: (u: (p: Project) => Project) => void;
  flush: () => Promise<void>;
}) {
  const flat: FlatChapter[] = useMemo(() => {
    const out: FlatChapter[] = [];
    let prev: Chapter | null = null;
    let g = 0;
    for (const v of project.volumes) {
      for (const c of v.chapters) {
        g += 1;
        out.push({ chapter: c, volume: v, prev, global: g });
        prev = c;
      }
    }
    return out;
  }, [project.volumes]);

  const [selectedId, setSelectedId] = useState<string | null>(
    flat[0]?.chapter.id ?? null
  );
  const [content, setContent] = useState("");
  const [generating, setGenerating] = useState(false);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<PanelMode>("prose");
  const [autoDigest, setAutoDigest] = useState(true);
  const [digesting, setDigesting] = useState(false);
  const [editingOutline, setEditingOutline] = useState(false);
  const autoRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);

  const current = flat.find((f) => f.chapter.id === selectedId) ?? null;

  // load chapter content into the editor when selection changes
  useEffect(() => {
    if (!current) {
      setContent("");
      return;
    }
    setContent(current.chapter.content);
  }, [selectedId]); // eslint-disable-line react-hooks/exhaustive-deps

  function commitContent(chapterId: string, text: string, status?: Chapter["status"]) {
    patch((p) => ({
      ...p,
      volumes: p.volumes.map((v) => ({
        ...v,
        chapters: v.chapters.map((c) =>
          c.id === chapterId
            ? {
                ...c,
                content: text,
                wordCount: countWords(text),
                status: status ?? (text ? "draft" : "empty"),
                updatedAt: Date.now(),
              }
            : c
        ),
      })),
    }));
  }

  // Edit the current chapter's outline (title / synopsis) in place. Shares the
  // same project data as the outline step, so changes sync both ways instantly
  // and never touch the written body.
  function commitOutline(
    chapterId: string,
    patchC: { title?: string; synopsis?: string }
  ) {
    patch((p) => ({
      ...p,
      volumes: p.volumes.map((v) => ({
        ...v,
        chapters: v.chapters.map((c) =>
          c.id === chapterId ? { ...c, ...patchC, updatedAt: Date.now() } : c
        ),
      })),
    }));
  }

  async function generateOne(target: FlatChapter): Promise<boolean> {
    const cfg = loadConfig();
    if (!cfg.apiKey) {
      setError("尚未配置模型接口，请先到「接口设置」填写。");
      return false;
    }
    if (!project.bible) return false;
    setSelectedId(target.chapter.id);
    setGenerating(true);
    setError(null);
    setContent("");
    abortRef.current = new AbortController();
    try {
      const full = await streamPost(
        "/api/generate/chapter",
        {
          config: cfg,
          setup: project.setup,
          bible: project.bible,
          volume: target.volume,
          chapter: target.chapter,
          prevChapter: target.prev,
          ctx: buildChapterContext(project, target.chapter.id),
        },
        (t) => {
          setContent(t);
          if (readerRef.current) {
            readerRef.current.scrollTop = readerRef.current.scrollHeight;
          }
        },
        abortRef.current.signal
      );
      commitContent(target.chapter.id, full, "draft");
      await flush();
      if (autoDigest) await digestChapter(target.chapter, full);
      return true;
    } catch (e) {
      if ((e as Error).name === "AbortError") return false;
      setError(e instanceof Error ? e.message : "生成失败");
      return false;
    } finally {
      setGenerating(false);
    }
  }

  async function runAuto() {
    autoRef.current = true;
    setAuto(true);
    // start from the current selection, else first unfinished
    let idx = current
      ? flat.findIndex((f) => f.chapter.id === current.chapter.id)
      : 0;
    while (autoRef.current && idx < flat.length) {
      const ft = flat[idx];
      if (ft.chapter.status !== "done") {
        // rebuild target with latest prev content from state snapshot
        const ok = await generateOne(ft);
        if (!ok) break;
      }
      idx += 1;
    }
    autoRef.current = false;
    setAuto(false);
  }

  function stopAll() {
    autoRef.current = false;
    setAuto(false);
    abortRef.current?.abort();
  }

  // Read a finished chapter and fold summary + codex/foreshadow updates back
  // into the project. Best-effort: archiving failure never blocks writing.
  async function digestChapter(chapter: Chapter, text: string) {
    const cfg = loadConfig();
    if (!cfg.apiKey || !text) return;
    setDigesting(true);
    try {
      const res = await fetch("/api/generate/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: cfg,
          chapter,
          content: text,
          knownCodexNames: (project.codex || []).map((e) => e.name),
          openForeshadows: activeForeshadows(project.foreshadows || []).map(
            (f) => f.title
          ),
        }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as ChapterDigest;
      patch((p) => applyDigest(p, chapter.id, data));
      await flush();
    } catch {
      // ignore; continuity tables just won't update this round
    } finally {
      setDigesting(false);
    }
  }

  function exportNovel() {
    const parts: string[] = [`《${project.title}》\n`];
    if (project.bible?.logline) parts.push(project.bible.logline + "\n");
    for (const v of project.volumes) {
      const written = v.chapters.filter((c) => c.content);
      if (written.length === 0) continue;
      parts.push(`\n\n${v.title}\n`);
      for (const c of v.chapters) {
        if (!c.content) continue;
        parts.push(`\n第${c.index}章 ${c.title}\n\n${c.content}\n`);
      }
    }
    const blob = new Blob([parts.join("\n")], {
      type: "text/plain;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${project.title}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (flat.length === 0) {
    return (
      <main className="shell" style={{ paddingTop: 60, textAlign: "center" }}>
        <p className="muted">还没有章节细纲。请先回到第一步展开各卷章节。</p>
      </main>
    );
  }

  const liveWords = countWords(content);

  return (
    <div className="write-layout">
      {/* Chapter navigator */}
      <aside className="write-nav panel scroll-y">
        <div style={{ padding: "14px 14px 8px", position: "sticky", top: 0, background: "var(--ink-800)", zIndex: 1 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              className="btn btn--primary btn--sm"
              style={{ flex: 1 }}
              onClick={auto ? stopAll : runAuto}
            >
              {auto ? "停止连写" : "连续创作"}
            </button>
            <button className="btn btn--ghost btn--sm" onClick={exportNovel}>
              导出
            </button>
          </div>
        </div>
        {project.volumes.map((v) => (
          <div key={v.id} style={{ padding: "6px 8px" }}>
            <div
              className="faint"
              style={{
                fontSize: 12,
                padding: "6px 8px",
                fontFamily: "var(--font-serif)",
              }}
            >
              {v.title}
            </div>
            {v.chapters.map((c) => {
              const active = c.id === selectedId;
              return (
                <button
                  key={c.id}
                  onClick={() => setSelectedId(c.id)}
                  className="nav-chapter"
                  style={{
                    background: active ? "var(--ink-700)" : "transparent",
                    borderLeft: active
                      ? "2px solid var(--cinnabar)"
                      : "2px solid transparent",
                  }}
                >
                  <span
                    className={
                      c.status === "done"
                        ? "dot dot--done"
                        : c.status === "draft"
                        ? "dot dot--draft"
                        : "dot"
                    }
                  />
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      color: active ? "var(--fg)" : "var(--fg-dim)",
                    }}
                  >
                    {c.index}. {c.title}
                  </span>
                  {c.wordCount > 0 && (
                    <span className="faint" style={{ fontSize: 11 }}>
                      {(c.wordCount / 1000).toFixed(1)}k
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      {/* Manuscript surface */}
      <section className="write-main">
        <div className="panel-tabs">
          <button
            className={mode === "prose" ? "ptab ptab--on" : "ptab"}
            onClick={() => setMode("prose")}
          >
            章节正文
          </button>
          <button
            className={mode === "codex" ? "ptab ptab--on" : "ptab"}
            onClick={() => setMode("codex")}
          >
            设定库 {project.codex?.length ? `· ${project.codex.length}` : ""}
          </button>
          <button
            className={mode === "foreshadow" ? "ptab ptab--on" : "ptab"}
            onClick={() => setMode("foreshadow")}
          >
            伏笔 {project.foreshadows?.length ? `· ${project.foreshadows.length}` : ""}
          </button>
          <label className="faint" style={{ marginLeft: "auto", fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoDigest}
              onChange={(e) => setAutoDigest(e.target.checked)}
            />
            写完自动归档
          </label>
          {digesting && (
            <span className="chip chip--cinnabar">归档中…</span>
          )}
        </div>

        {mode === "codex" ? (
          <CodexPanel project={project} patch={patch} />
        ) : mode === "foreshadow" ? (
          <ForeshadowPanel project={project} patch={patch} />
        ) : (
          current && (
          <>
            <div className="write-head">
              <div style={{ minWidth: 0 }}>
                <div className="faint" style={{ fontSize: 12 }}>
                  {current.volume.title}
                </div>
                <h2 style={{ fontSize: 22 }}>
                  第{current.chapter.index}章 {current.chapter.title}
                </h2>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span className="chip">{formatWords(liveWords)}</span>
                <button
                  className="btn btn--sm"
                  onClick={() =>
                    commitContent(
                      current.chapter.id,
                      content,
                      current.chapter.status === "done" ? "draft" : "done"
                    )
                  }
                >
                  {current.chapter.status === "done" ? "取消完成" : "标记完成"}
                </button>
                {generating ? (
                  <button className="btn btn--ghost btn--sm" onClick={stopAll}>
                    停止
                  </button>
                ) : (
                  <>
                    {current.chapter.content && (
                      <button
                        className="btn btn--sm"
                        onClick={() =>
                          digestChapter(current.chapter, content)
                        }
                        disabled={digesting}
                      >
                        {digesting ? "归档中…" : "归档本章"}
                      </button>
                    )}
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={() => generateOne(current)}
                    >
                      {current.chapter.content ? "重写本章" : "生成本章"}
                    </button>
                  </>
                )}
              </div>
            </div>

            <div
              className="chip"
              style={{
                margin: "0 0 14px",
                display: "block",
                padding: "8px 12px",
                lineHeight: 1.5,
                color: "var(--fg-dim)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 8,
                  marginBottom: editingOutline ? 8 : 0,
                }}
              >
                <b style={{ color: "var(--fg)" }}>本章脉络</b>
                {!editingOutline && (
                  <span style={{ flex: 1, minWidth: 0 }}>
                    {current.chapter.synopsis || "（无）"}
                  </span>
                )}
                <button
                  className="btn btn--ghost btn--sm"
                  style={{ marginLeft: "auto", padding: "2px 10px", flexShrink: 0 }}
                  onClick={() => setEditingOutline((o) => !o)}
                >
                  {editingOutline ? "完成" : "编辑脉络"}
                </button>
              </div>
              {editingOutline && (
                <div style={{ display: "grid", gap: 8 }}>
                  <input
                    className="input"
                    value={current.chapter.title}
                    placeholder="本章标题"
                    onChange={(e) =>
                      commitOutline(current.chapter.id, { title: e.target.value })
                    }
                    style={{ fontFamily: "var(--font-serif)", fontWeight: 600 }}
                  />
                  <textarea
                    className="textarea"
                    rows={3}
                    value={current.chapter.synopsis}
                    placeholder="本章脉络：关键事件、人物行动、情绪转折、章末悬念"
                    onChange={(e) =>
                      commitOutline(current.chapter.id, {
                        synopsis: e.target.value,
                      })
                    }
                    style={{ fontSize: 13 }}
                  />
                  <span className="faint" style={{ fontSize: 12 }}>
                    改动即时保存，并与大纲同步；生成 / 重写本章时会依据此脉络。不会影响已写正文。
                  </span>
                </div>
              )}
            </div>

            {error && (
              <p
                className="chip chip--cinnabar"
                style={{ display: "block", padding: "10px 12px", marginBottom: 12 }}
              >
                {error}
              </p>
            )}

            <div className="manuscript" style={{ padding: "22px 26px" }}>
              {generating ? (
                <div
                  ref={readerRef}
                  className="reader scroll-y writing-cursor"
                  style={{ maxHeight: "58vh", whiteSpace: "pre-wrap" }}
                >
                  {content}
                </div>
              ) : (
                <textarea
                  value={content}
                  onChange={(e) => {
                    setContent(e.target.value);
                    commitContent(current.chapter.id, e.target.value);
                  }}
                  placeholder="点击「生成本章」开始创作，或在此直接撰写。字里行间，皆可推敲。"
                  style={{
                    width: "100%",
                    minHeight: "58vh",
                    border: "none",
                    outline: "none",
                    resize: "vertical",
                  }}
                />
              )}
            </div>
          </>
          )
        )}
      </section>
    </div>
  );
}

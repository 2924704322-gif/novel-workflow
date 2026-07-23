"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  loadConfig,
  loadReconcilePref,
  requestReconcile,
  saveReconcilePref,
  streamPost,
  formatWords,
  uid,
} from "@/lib/client";
import {
  countWords,
  effectiveStyleCards,
  enabledPrompts,
  recordPromptEntry,
  type Chapter,
  type Project,
  type Volume,
} from "@/lib/types";
import {
  activeForeshadows,
  applyDigest,
  buildChapterContext,
  flattenChapters,
  type ChapterDigest,
} from "@/lib/retrieval";
import {
  applyReconcile,
  collectDownstream,
  hasReconcileContent,
} from "@/lib/reconcile";
import type { CollectOptions, ReconcileChange } from "@/lib/reconcile";
import { ChangeSummary, type ReconcileState } from "./ChangeSummary";
import { CodexPanel, ForeshadowPanel } from "./CodexPanel";
import { PromptLibraryPanel } from "./PromptLibrary";

type PanelMode = "prose" | "codex" | "foreshadow" | "prompts";

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

  // Continuous, book-wide chapter number (reading order) keyed by chapter id.
  // Chapters never restart their numbering across volumes.
  const globalOf = useMemo(
    () => new Map(flat.map((f) => [f.chapter.id, f.global])),
    [flat]
  );

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
  // 重写正文后是否自动级联统一下游（持久化于本地）。
  const [autoReconcile, setAutoReconcile] = useState(true);
  const [reconcile, setReconcile] = useState<ReconcileState>({
    busy: false,
    result: null,
  });
  // 续写前先提炼前几章大致内容（导入的旧章往往没有摘要），生成时给足“前情”。
  const [preparing, setPreparing] = useState(false);
  const [editingOutline, setEditingOutline] = useState(false);
  // 重写本章方向对话框：点「重写本章」先问方向，确认后再带方向重写。
  const [showRegen, setShowRegen] = useState(false);
  const [regenDir, setRegenDir] = useState("");
  const autoRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);

  const current = flat.find((f) => f.chapter.id === selectedId) ?? null;

  // 读取本地保存的「重写后自动统一」偏好（避免 SSR 水合不一致，挂载后再读）。
  useEffect(() => {
    setAutoReconcile(loadReconcilePref());
  }, []);

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

  // Continuation continuity: make sure the up-to-5 chapters right before the
  // target have a summary. Imported chapters start with none, so we digest them
  // on demand (once) and cache the result — this both fills the "前情回顾" the
  // writer sees and enriches the codex. Returns the updated project so the very
  // next context build sees the fresh summaries (React state is async).
  async function ensureContextSummaries(
    proj: Project,
    target: FlatChapter
  ): Promise<Project> {
    const cfg = loadConfig();
    if (!cfg.apiKey) return proj;
    const localFlat = flattenChapters(proj);
    const tg =
      localFlat.find((f) => f.chapter.id === target.chapter.id)?.global ??
      localFlat.length + 1;
    const need = localFlat
      .filter((f) => f.global < tg && f.chapter.content && !f.chapter.summary)
      .slice(-5);
    if (!need.length) return proj;
    setPreparing(true);
    let updated = proj;
    const applied: { id: string; data: ChapterDigest }[] = [];
    try {
      for (const f of need) {
        try {
          const res = await fetch("/api/generate/digest", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              config: cfg,
              chapter: f.chapter,
              globalNo: f.global,
              content: f.chapter.content,
              knownCodexNames: (updated.codex || []).map((e) => e.name),
              openForeshadows: activeForeshadows(updated.foreshadows || []).map(
                (x) => x.title
              ),
            }),
          });
          if (!res.ok) continue;
          const data = (await res.json()) as ChapterDigest;
          updated = applyDigest(updated, f.chapter.id, data);
          applied.push({ id: f.chapter.id, data });
        } catch {
          // one chapter failing to summarize shouldn't block the rest
        }
      }
      // 以函数式合并写回最新状态：只叠加本次摘要，绝不用陈旧快照整体覆盖，
      // 否则连续生成时会把循环内已写的其它章节抹掉。
      if (applied.length) {
        patch((p) =>
          applied.reduce((acc, a) => applyDigest(acc, a.id, a.data), p)
        );
        await flush();
      }
    } finally {
      setPreparing(false);
    }
    return updated;
  }

  // Append a fresh empty chapter to the last volume and select it, so the user
  // can immediately continue the imported book from where it ends.
  function addNextChapter() {
    const lastVol = project.volumes[project.volumes.length - 1];
    if (!lastVol) return;
    const id = uid();
    const newChap: Chapter = {
      id,
      index: lastVol.chapters.length + 1,
      title: "新章节",
      synopsis: "",
      content: "",
      summary: "",
      wordCount: 0,
      status: "empty",
      updatedAt: Date.now(),
    };
    patch((p) => ({
      ...p,
      volumes: p.volumes.map((v) =>
        v.id === lastVol.id ? { ...v, chapters: [...v.chapters, newChap] } : v
      ),
    }));
    setSelectedId(id);
    setMode("prose");
    setEditingOutline(true);
  }

  async function generateOne(
    base: Project,
    target: FlatChapter,
    direction?: string
  ): Promise<Project | null> {
    const cfg = loadConfig();
    if (!cfg.apiKey) {
      setError("尚未配置模型接口，请先到「接口设置」填写。");
      return null;
    }
    if (!base.bible) return null;
    // 本章已有正文 = 「重写」，完成后需级联统一下游（首次生成则不需）。
    const wasRewrite = Boolean(target.chapter.content);
    setSelectedId(target.chapter.id);
    setGenerating(true);
    setError(null);
    setContent("");
    abortRef.current = new AbortController();
    try {
      // Req: 提炼往前至少五章的大致内容，保证新章节不脱离剧情。
      const proj = await ensureContextSummaries(base, target);
      // 用最新快照重建目标的分卷/前章，保证连续续写时前情是刚写完的那一章。
      const freshFlat = flattenChapters(proj);
      const fresh = freshFlat.find((f) => f.chapter.id === target.chapter.id);
      const targetChapter = fresh?.chapter ?? target.chapter;
      const prevChapter = fresh?.prev ?? target.prev;
      const volume =
        proj.volumes.find((v) =>
          v.chapters.some((c) => c.id === target.chapter.id)
        ) ?? target.volume;
      const full = await streamPost(
        "/api/generate/chapter",
        {
          config: cfg,
          setup: proj.setup,
          bible: proj.bible,
          volume,
          chapter: targetChapter,
          prevChapter,
          ctx: buildChapterContext(proj, target.chapter.id),
          globalNo: target.global,
          direction,
          prompts: enabledPrompts(proj),
        },
        (t) => {
          setContent(t);
          if (readerRef.current) {
            readerRef.current.scrollTop = readerRef.current.scrollHeight;
          }
        },
        abortRef.current.signal
      );
      // 先以函数式合并写回正文（不依赖陈旧快照），同时维护本地最新快照。
      let updated = withContent(proj, target.chapter.id, full);
      patch((p) => withContent(p, target.chapter.id, full));
      await flush();
      // 带方向的重写 = 一条可复用的写作诉求，自动记入提示词库（标明来自正文）。
      if (direction && direction.trim()) {
        patch((p) =>
          recordPromptEntry(p, "prose", direction, `第${target.global}章`)
        );
      }
      // 重写时即使未开自动归档，也需刷新本章摘要/设定库/伏笔以便统一。
      const wantDigest = autoDigest || (wasRewrite && autoReconcile);
      let digest: ChapterDigest | null = null;
      if (wantDigest) {
        setDigesting(true);
        try {
          digest = await fetchDigestData(
            updated,
            targetChapter,
            full,
            target.global
          );
          if (digest) {
            updated = applyDigest(updated, target.chapter.id, digest);
            patch((p) => applyDigest(p, target.chapter.id, digest!));
            await flush();
          }
        } finally {
          setDigesting(false);
        }
      }
      // 重写已有正文：对本章及之后的脉络/摘要/分卷梳理一致性（不改正文）。
      if (wasRewrite) {
        const chapTitle =
          updated.volumes
            .flatMap((v) => v.chapters)
            .find((c) => c.id === target.chapter.id)?.title ||
          target.chapter.title;
        const detail = digest?.summary
          ? `第${target.global}章《${chapTitle}》重写后的内容概要：\n${digest.summary}`
          : `第${target.global}章《${chapTitle}》正文重写后节选：\n${
              full.length > 800 ? full.slice(0, 800) + "…" : full
            }`;
        await runReconcile(
          updated,
          {
            origin: "prose",
            label: `第${target.global}章正文已重写`,
            detail,
            direction,
          },
          { fromGlobal: target.global }
        );
      }
      return updated;
    } catch (e) {
      if ((e as Error).name === "AbortError") return null;
      setError(e instanceof Error ? e.message : "生成失败");
      return null;
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
    // 串行下传最新快照：每章基于上一次生成后的完整工程推进，
    // 避免闭包里的陈旧 project 导致前面章节被覆盖丢失。
    let working = project;
    while (autoRef.current && idx < flat.length) {
      const ft = flat[idx];
      if (ft.chapter.status !== "done") {
        // rebuild target with latest prev content from state snapshot
        const result = await generateOne(working, ft);
        if (!result) break;
        working = result;
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

  // Read a finished chapter and return its digest (summary + codex/foreshadow
  // updates) WITHOUT mutating state. Best-effort: returns null on any failure.
  async function fetchDigestData(
    baseProject: Project,
    chapter: Chapter,
    text: string,
    globalNo?: number
  ): Promise<ChapterDigest | null> {
    const cfg = loadConfig();
    if (!cfg.apiKey || !text) return null;
    try {
      const res = await fetch("/api/generate/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: cfg,
          chapter,
          globalNo,
          content: text,
          knownCodexNames: (baseProject.codex || []).map((e) => e.name),
          openForeshadows: activeForeshadows(baseProject.foreshadows || []).map(
            (f) => f.title
          ),
        }),
      });
      if (!res.ok) return null;
      return (await res.json()) as ChapterDigest;
    } catch {
      return null;
    }
  }

  // Manual 「归档本章」: fold summary + codex/foreshadow updates back in.
  // Archiving failure never blocks writing.
  async function digestChapter(chapter: Chapter, text: string, globalNo?: number) {
    if (!text) return;
    setDigesting(true);
    try {
      const data = await fetchDigestData(project, chapter, text, globalNo);
      if (data) {
        patch((p) => applyDigest(p, chapter.id, data));
        await flush();
      }
    } finally {
      setDigesting(false);
    }
  }

  // Pure: return a project with the chapter's prose/body set (mirrors
  // commitContent) so we can chain digest/reconcile off a fresh snapshot.
  function withContent(
    proj: Project,
    chapterId: string,
    text: string
  ): Project {
    return {
      ...proj,
      volumes: proj.volumes.map((v) => ({
        ...v,
        chapters: v.chapters.map((c) =>
          c.id === chapterId
            ? {
                ...c,
                content: text,
                wordCount: countWords(text),
                status: "draft" as const,
                updatedAt: Date.now(),
              }
            : c
        ),
      })),
    };
  }

  // After a regeneration, collect the affected downstream artifacts, ask the
  // model to re-align them, write the edits back, and surface a change summary.
  // baseProject must already reflect the change (React state is async).
  async function runReconcile(
    baseProject: Project,
    change: ReconcileChange,
    opts: CollectOptions
  ) {
    if (!autoReconcile) return;
    const cfg = loadConfig();
    if (!cfg.apiKey) return;
    const payload = collectDownstream(baseProject, opts);
    if (payload.chapters.length === 0 && payload.volumes.length === 0) return;
    setReconcile({ busy: true, result: null });
    const result = await requestReconcile({
      config: cfg,
      change,
      payload,
      bible: baseProject.bible,
    });
    if (!result || !hasReconcileContent(result)) {
      setReconcile({ busy: false, result: null });
      return;
    }
    patch((p) => applyReconcile(p, result));
    setReconcile({ busy: false, result });
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
        parts.push(`\n第${globalOf.get(c.id) ?? c.index}章 ${c.title}\n\n${c.content}\n`);
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
          <button
            className="btn btn--sm"
            style={{ width: "100%", marginTop: 8 }}
            onClick={addNextChapter}
            disabled={generating || auto}
            title="在末尾新增一章，接着往下写（生成时会自动提炼前情）"
          >
            ＋ 续写新章
          </button>
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
                    {globalOf.get(c.id) ?? c.index}. {c.title}
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
          <button
            className={mode === "prompts" ? "ptab ptab--on" : "ptab"}
            onClick={() => setMode("prompts")}
          >
            提示词库 {project.prompts?.length ? `· ${project.prompts.length}` : ""}
          </button>
          <label className="faint" style={{ marginLeft: "auto", fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={autoDigest}
              onChange={(e) => setAutoDigest(e.target.checked)}
            />
            写完自动归档
          </label>
          <label
            className="faint"
            style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}
            title="重写本章后，自动校对并统一本章及后续章节的脉络/摘要/分卷梳理（不会改写已写正文）"
          >
            <input
              type="checkbox"
              checked={autoReconcile}
              onChange={(e) => {
                setAutoReconcile(e.target.checked);
                saveReconcilePref(e.target.checked);
              }}
            />
            重写后自动统一
          </label>
          {digesting && (
            <span className="chip chip--cinnabar">归档中…</span>
          )}
          {preparing && (
            <span className="chip chip--cinnabar">提炼前情中…</span>
          )}
        </div>

        <ChangeSummary
          state={reconcile}
          onDismiss={() => setReconcile({ busy: false, result: null })}
        />

        {mode === "codex" ? (
          <CodexPanel project={project} patch={patch} />
        ) : mode === "foreshadow" ? (
          <ForeshadowPanel project={project} patch={patch} />
        ) : mode === "prompts" ? (
          <PromptLibraryPanel project={project} patch={patch} />
        ) : (
          current && (
          <>
            <div className="write-head">
              <div style={{ minWidth: 0 }}>
                <div className="faint" style={{ fontSize: 12 }}>
                  {current.volume.title}
                </div>
                <h2 style={{ fontSize: 22 }}>
                  第{current.global}章 {current.chapter.title}
                </h2>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                {effectiveStyleCards(project.setup).map((c) => (
                  <span
                    key={c.sourceFileHash}
                    className="chip chip--cinnabar"
                    title={`已应用文风卡，生成本章时会据此模仿。来源：${c.sourceFileName}`}
                  >
                    文风·{c.styleName}
                  </span>
                ))}
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
                          digestChapter(current.chapter, content, current.global)
                        }
                        disabled={digesting}
                      >
                        {digesting ? "归档中…" : "归档本章"}
                      </button>
                    )}
                    <button
                      className="btn btn--primary btn--sm"
                      onClick={() => {
                        if (current.chapter.content) {
                          setRegenDir("");
                          setShowRegen(true);
                        } else {
                          generateOne(project, current);
                        }
                      }}
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

      {showRegen && current && (
        <RegenDialog
          title="重写本章正文"
          value={regenDir}
          onChange={setRegenDir}
          onCancel={() => setShowRegen(false)}
          onConfirm={() => {
            const dir = regenDir.trim() || undefined;
            setShowRegen(false);
            generateOne(project, current, dir);
          }}
        />
      )}
    </div>
  );
}

// 重写方向弹框：让用户先描述想要的调整方向，再带着方向重写。方向可留空（等同普通重写）。
function RegenDialog({
  title,
  value,
  onChange,
  onCancel,
  onConfirm,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 50,
        background: "rgba(0,0,0,0.42)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
    >
      <div
        className="panel fadeup"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 24, width: "100%", maxWidth: 520 }}
      >
        <h3 style={{ fontSize: 17, marginBottom: 6 }}>{title}</h3>
        <p className="faint" style={{ fontSize: 12.5, marginBottom: 14 }}>
          请描述这次想要的调整方向（如：多写打斗细节、放慢节奏、强化内心戏、改为第一人称……）。留空则直接重写。
        </p>
        <textarea
          className="textarea"
          rows={4}
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="例：开头直接切入冲突；多一段环境渲染；对话更锐利……"
        />
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
            marginTop: 16,
          }}
        >
          <button className="btn btn--ghost btn--sm" onClick={onCancel}>
            取消
          </button>
          <button className="btn btn--primary btn--sm" onClick={onConfirm}>
            {value.trim() ? "按此方向重写" : "直接重写"}
          </button>
        </div>
      </div>
    </div>
  );
}

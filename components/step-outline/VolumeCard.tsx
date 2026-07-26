import { useState } from "react";
import { uid } from "@/lib/client";
import type { Chapter, Volume } from "@/lib/types";
import { ChapterRow } from "./ChapterRow";

export function VolumeCard({
  volume,
  startNo,
  expanding,
  onExpand,
  onDelete,
  onChange,
  onRegenChapter,
  onGenNext,
  busyChapterId,
  nextBusy,
}: {
  volume: Volume;
  startNo: number;
  expanding: boolean;
  onExpand: () => void;
  onDelete: () => void;
  onChange: (v: Volume) => void;
  onRegenChapter: (chapterId: string) => void;
  onGenNext: () => void;
  busyChapterId: string | null;
  nextBusy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const done = volume.chapters.length > 0;

  const reindex = (chs: Chapter[]) => chs.map((c, i) => ({ ...c, index: i + 1 }));
  const setChapters = (chs: Chapter[]) =>
    onChange({ ...volume, chapters: chs });
  const updateChapter = (id: string, patch: Partial<Chapter>) =>
    setChapters(
      volume.chapters.map((c) => (c.id === id ? { ...c, ...patch } : c))
    );
  const deleteChapter = (id: string) =>
    setChapters(reindex(volume.chapters.filter((c) => c.id !== id)));
  const addChapter = () =>
    setChapters(
      reindex([
        ...volume.chapters,
        {
          id: uid(),
          index: volume.chapters.length + 1,
          title: "新章节",
          synopsis: "",
          content: "",
          summary: "",
          wordCount: 0,
          status: "empty" as const,
          updatedAt: Date.now(),
        },
      ])
    );
  const moveChapter = (id: string, dir: -1 | 1) => {
    const i = volume.chapters.findIndex((c) => c.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= volume.chapters.length) return;
    const next = [...volume.chapters];
    [next[i], next[j]] = [next[j], next[i]];
    setChapters(reindex(next));
  };
  return (
    <div className="panel" style={{ padding: 16 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <input
            value={volume.title}
            onChange={(e) => onChange({ ...volume, title: e.target.value })}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--fg)",
              fontFamily: "var(--font-serif)",
              fontSize: 16,
              fontWeight: 600,
              width: "100%",
              padding: 0,
            }}
          />
          <textarea
            className="textarea"
            rows={2}
            value={volume.summary}
            onChange={(e) => onChange({ ...volume, summary: e.target.value })}
            style={{ marginTop: 8, fontSize: 13 }}
          />
        </div>
        <div style={{ textAlign: "right", flexShrink: 0, width: 148 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 6,
              fontSize: 13,
              color: "var(--fg-dim)",
            }}
          >
            <span>计划</span>
            <input
              className="input"
              type="number"
              min={1}
              value={volume.plannedChapters}
              onChange={(e) =>
                onChange({
                  ...volume,
                  plannedChapters: Math.max(1, parseInt(e.target.value) || 1),
                })
              }
              style={{ width: 58, textAlign: "center", padding: "4px 6px" }}
            />
            <span>章</span>
          </div>
          {done && (
            <span className="chip chip--jade" style={{ marginTop: 8 }}>
              已生成 {volume.chapters.length} 章
            </span>
          )}
          <div style={{ marginTop: 8 }}>
            <button
              className="btn btn--ghost btn--sm"
              onClick={onExpand}
              disabled={expanding}
            >
              {expanding
                ? "展开中…"
                : done
                ? "重新展开"
                : "展开本卷章节"}
            </button>
          </div>
          <button
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 6 }}
            onClick={() => setOpen((o) => !o)}
          >
            {open ? "收起章节脉络" : "章节脉络"}
          </button>
          <button
            className="btn btn--ghost btn--sm btn--danger"
            style={{ marginTop: 6 }}
            onClick={onDelete}
          >
            删除本卷
          </button>
        </div>
      </div>

      {open && (
        <div
          style={{
            marginTop: 14,
            borderTop: "1px solid var(--line-strong)",
            paddingTop: 14,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 8,
              marginBottom: 10,
            }}
          >
            <span className="label" style={{ margin: 0 }}>
              章节脉络
            </span>
            <span className="faint" style={{ fontSize: 12, marginLeft: "auto" }}>
              共 {volume.chapters.length} 章 · 可逐章编辑标题与脉络
            </span>
          </div>

          {volume.chapters.length === 0 ? (
            <p className="muted" style={{ fontSize: 13, margin: "4px 0 12px" }}>
              还没有章节。点「展开本卷章节」让 AI 依据本卷主线生成，或手动「+ 添加一章」。
            </p>
          ) : (
            <div
              className="scroll-y"
              style={{
                display: "grid",
                gap: 10,
                maxHeight: 420,
                paddingRight: 4,
              }}
            >
              {volume.chapters.map((c, i) => (
                <ChapterRow
                  key={c.id}
                  chapter={c}
                  globalNo={startNo + i + 1}
                  busy={busyChapterId === c.id}
                  canMoveUp={i > 0}
                  canMoveDown={i < volume.chapters.length - 1}
                  onRegen={() => onRegenChapter(c.id)}
                  onMoveUp={() => moveChapter(c.id, -1)}
                  onMoveDown={() => moveChapter(c.id, 1)}
                  onDelete={() => deleteChapter(c.id)}
                  onTitleChange={(v) => updateChapter(c.id, { title: v })}
                  onSynopsisChange={(v) => updateChapter(c.id, { synopsis: v })}
                />
              ))}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
            <button className="btn btn--ghost btn--sm" onClick={addChapter}>
              + 添加一章
            </button>
            <button
              className="btn btn--ghost btn--sm"
              title="根据本卷已有章节上下文，AI 续写下一章的标题与脉络"
              disabled={nextBusy}
              onClick={onGenNext}
            >
              {nextBusy ? "续写中…" : "✨ 续写下一章（AI）"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

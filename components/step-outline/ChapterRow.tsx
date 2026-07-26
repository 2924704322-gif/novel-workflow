import type { Chapter } from "@/lib/types";

export function ChapterRow({
  chapter,
  globalNo,
  busy,
  canMoveUp,
  canMoveDown,
  onRegen,
  onMoveUp,
  onMoveDown,
  onDelete,
  onTitleChange,
  onSynopsisChange,
}: {
  chapter: Chapter;
  globalNo: number;
  busy: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onRegen: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
  onTitleChange: (v: string) => void;
  onSynopsisChange: (v: string) => void;
}) {
  return (
    <div
      key={chapter.id}
      style={{
        border: "1px solid var(--line-strong)",
        borderRadius: 8,
        padding: "10px 12px",
        background: "var(--ink)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 6,
        }}
      >
        <span
          className="faint"
          style={{ fontSize: 12, flexShrink: 0 }}
        >
          第 {globalNo} 章
        </span>
        {chapter.content && (
          <span
            className="chip chip--jade"
            title="本章已有正文，编辑脉络不会删除正文"
          >
            {chapter.status === "done" ? "已完成" : "有草稿"} · {chapter.wordCount} 字
          </span>
        )}
        <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
          <button
            className="btn btn--ghost btn--sm"
            title="根据上下文重新生成本章脉络（会先问方向，不影响已有正文）"
            disabled={busy}
            onClick={onRegen}
          >
            {busy ? "重生中…" : "↺ 重生脉络"}
          </button>
          <button
            className="btn btn--ghost btn--sm"
            title="上移"
            disabled={!canMoveUp}
            onClick={onMoveUp}
          >
            ↑
          </button>
          <button
            className="btn btn--ghost btn--sm"
            title="下移"
            disabled={!canMoveDown}
            onClick={onMoveDown}
          >
            ↓
          </button>
          <button
            className="btn btn--ghost btn--sm btn--danger"
            title="删除本章"
            onClick={onDelete}
          >
            ×
          </button>
        </span>
      </div>
      <input
        className="input"
        value={chapter.title}
        placeholder="本章标题"
        onChange={(e) => onTitleChange(e.target.value)}
        style={{
          fontFamily: "var(--font-serif)",
          fontWeight: 600,
        }}
      />
      <textarea
        className="textarea"
        rows={2}
        value={chapter.synopsis}
        placeholder="本章脉络：关键事件、人物行动、情绪转折、章末悬念"
        onChange={(e) => onSynopsisChange(e.target.value)}
        style={{ marginTop: 6, fontSize: 13 }}
      />
    </div>
  );
}

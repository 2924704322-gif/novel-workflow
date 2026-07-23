"use client";

// A dismissible card shown after a regeneration triggers downstream
// reconciliation. It surfaces (a) that we're working, (b) what the model
// unified across volume/chapter planning, and (c) which already-written
// chapters may now be stale (we never auto-rewrite prose).

import type { ReconcileResult, ReconcileUpdateKind } from "@/lib/reconcile";

const KIND_LABEL: Record<ReconcileUpdateKind, string> = {
  "volume-summary": "分卷梗概",
  "chapter-synopsis": "章节脉络",
  "chapter-title": "章节标题",
  "chapter-summary": "章节摘要",
};

export interface ReconcileState {
  busy: boolean;
  result: ReconcileResult | null;
}

export function ChangeSummary({
  state,
  onDismiss,
}: {
  state: ReconcileState;
  onDismiss: () => void;
}) {
  const { busy, result } = state;
  if (!busy && !result) return null;

  // Tally applied updates by kind for a compact summary line.
  const counts = new Map<ReconcileUpdateKind, number>();
  for (const u of result?.updates || []) {
    counts.set(u.kind, (counts.get(u.kind) || 0) + 1);
  }
  const staleProse = result?.staleProse || [];

  return (
    <div className="panel fadeup" style={{ padding: "14px 16px", marginTop: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="seal">校</span>
          <strong style={{ fontFamily: "var(--font-serif)" }}>
            {busy ? "正在统一相关内容…" : "一致性统一完成"}
          </strong>
        </div>
        {!busy && (
          <button className="btn btn--ghost btn--sm" onClick={onDismiss}>
            知道了
          </button>
        )}
      </div>

      {busy && (
        <p className="hint" style={{ marginTop: 8 }}>
          正在对照本次改动，校对分卷梗概、后续章节脉络与摘要，保持全书一致。
        </p>
      )}

      {!busy && result && (
        <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
          {result.changeSummary?.trim() && (
            <p style={{ margin: 0, lineHeight: 1.7, color: "var(--fg)" }}>
              {result.changeSummary.trim()}
            </p>
          )}

          {counts.size > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {[...counts.entries()].map(([kind, n]) => (
                <span key={kind} className="chip chip--jade">
                  {KIND_LABEL[kind]} ×{n}
                </span>
              ))}
            </div>
          )}

          {counts.size === 0 && (
            <p className="hint" style={{ margin: 0 }}>
              下游内容已一致，无需改动。
            </p>
          )}

          {staleProse.length > 0 && (
            <div
              style={{
                borderTop: "1px solid var(--line)",
                paddingTop: 8,
                display: "grid",
                gap: 6,
              }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
                <span className="chip chip--cinnabar">待复核</span>
                {staleProse.map((g) => (
                  <span key={g} className="chip">
                    第 {g} 章
                  </span>
                ))}
              </div>
              <p className="hint" style={{ margin: 0 }}>
                以上章节的正文可能与本次改动冲突。为避免覆盖你的文字，正文未被自动改写，请自行复核。
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

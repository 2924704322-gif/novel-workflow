"use client";

// A reusable "card library" panel for the 拆书工坊 page. It lists previously
// saved style cards or story archives so the user can reload one instantly
// (方便下次直接调用) or delete it (增删). It is deliberately data-shape agnostic:
// callers map their StyleCard[] / StoryArchive[] into LibraryItem[].

export interface LibraryItem {
  hash: string; // sourceFileHash — the stable key used by the API
  name: string; // display name (styleName / archive title)
  sourceFileName: string;
  createdAt: number;
}

export default function CardLibrary({
  title,
  items,
  activeHash,
  busy,
  onLoad,
  onDelete,
}: {
  title: string;
  items: LibraryItem[];
  activeHash?: string;
  busy?: boolean;
  onLoad: (hash: string) => void;
  onDelete: (hash: string) => void;
}) {
  return (
    <section className="panel" style={{ padding: 18, marginBottom: 18 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: items.length ? 12 : 0,
        }}
      >
        <span style={{ fontFamily: "var(--font-serif)", fontSize: 15 }}>{title}</span>
        <span className="faint" style={{ fontSize: 13 }}>
          （共 {items.length} 张，点「调用」直接载入，无需重新分析）
        </span>
      </div>

      {items.length === 0 ? (
        <p className="faint" style={{ fontSize: 13, margin: 0 }}>
          暂无已保存卡片。上传并分析一本书后会自动保存在这里。
        </p>
      ) : (
        <div style={{ display: "grid", gap: 8 }}>
          {items.map((it) => {
            const active = it.hash === activeHash;
            return (
              <div
                key={it.hash}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: active
                    ? "1px solid var(--cinnabar)"
                    : "1px solid var(--line)",
                  background: active ? "var(--panel-2, transparent)" : "transparent",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 14, color: "var(--fg)" }}>
                    {it.name || "未命名"}
                  </div>
                  <div className="faint" style={{ fontSize: 12, marginTop: 2 }}>
                    {it.sourceFileName || "未知来源"}
                    {it.createdAt
                      ? ` · ${new Date(it.createdAt).toLocaleDateString()}`
                      : ""}
                  </div>
                </div>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => onLoad(it.hash)}
                  disabled={busy || active}
                  title={active ? "当前已载入" : "载入这张卡片"}
                >
                  {active ? "已载入" : "调用"}
                </button>
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => onDelete(it.hash)}
                  disabled={busy}
                  title="从卡库删除"
                  style={{ color: "var(--cinnabar)" }}
                >
                  删除
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

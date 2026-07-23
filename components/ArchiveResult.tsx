"use client";

import type { StoryArchive } from "@/lib/types";

// Pure display for a StoryArchive plus the two actions the page wires up:
// export JSON and "以此开新书" (create a derivative project and jump to it).
export default function ArchiveResult({
  archive,
  creating,
  createMsg,
  onCreate,
  onExport,
}: {
  archive: StoryArchive;
  creating: boolean;
  createMsg: string | null;
  onCreate: () => void;
  onExport: () => void;
}) {
  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
          marginBottom: 14,
        }}
      >
        <h2 style={{ fontSize: 20 }}>
          作品档案 · <span style={{ color: "var(--cinnabar)" }}>{archive.title}</span>
        </h2>
        <button className="btn btn--ghost btn--sm" onClick={onExport}>
          导出 .json
        </button>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))",
          gap: 14,
        }}
      >
        <Block title="整体剧情概述" span>
          <Para text={archive.synopsis} />
        </Block>

        <Block title="世界观设定">
          <Para text={archive.worldbuilding} />
        </Block>

        {archive.powerSystem && (
          <Block title="力量体系 / 世界规则">
            <Para text={archive.powerSystem} />
          </Block>
        )}

        <Block title="核心主题与基调">
          <Para text={archive.themes} />
          {archive.styleHint && <Row k="文风提示" v={archive.styleHint} />}
        </Block>

        {archive.characters.length > 0 && (
          <Block title={`主要人物 · ${archive.characters.length}`} span>
            <div style={{ display: "grid", gap: 10 }}>
              {archive.characters.map((c, i) => (
                <div key={i} style={{ fontSize: 13, lineHeight: 1.6 }}>
                  <span style={{ color: "var(--fg)", fontWeight: 600 }}>
                    {c.name}
                  </span>
                  {c.role && (
                    <span className="chip" style={{ fontSize: 12, marginLeft: 8 }}>
                      {c.role}
                    </span>
                  )}
                  {c.aliases.length > 0 && (
                    <span className="faint" style={{ marginLeft: 8, fontSize: 12 }}>
                      又称：{c.aliases.join("、")}
                    </span>
                  )}
                  {c.profile && (
                    <div style={{ color: "var(--fg-dim)", marginTop: 2 }}>
                      {c.profile}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Block>
        )}

        {(archive.locations.length > 0 || archive.factions.length > 0) && (
          <Block title="关键地点与势力">
            <EntryList label="地点" items={archive.locations} />
            <EntryList label="势力" items={archive.factions} />
          </Block>
        )}

        {archive.mainPlot.length > 0 && (
          <Block title={`主线剧情脉络 · ${archive.mainPlot.length}`} span>
            <ol style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
              {archive.mainPlot.map((p, i) => (
                <li
                  key={i}
                  style={{ fontSize: 13, lineHeight: 1.6, color: "var(--fg-dim)" }}
                >
                  {p}
                </li>
              ))}
            </ol>
          </Block>
        )}
      </div>

      {/* Create a derivative project */}
      <section className="panel" style={{ padding: 18, marginTop: 18 }}>
        <div
          style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}
        >
          <span style={{ fontFamily: "var(--font-serif)" }}>二创开新书：</span>
          <span className="faint" style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
            一键新建作品，把世界观、人物、设定填入故事圣经与设定库；原作主线仅作参考，随后可在大纲页自由发展全新剧情。
          </span>
          <button
            className="btn btn--primary btn--sm"
            onClick={onCreate}
            disabled={creating}
          >
            {creating ? "创建中…" : "以此开新书"}
          </button>
        </div>
        {createMsg && (
          <p className="faint" style={{ marginTop: 10, fontSize: 13 }}>
            {createMsg}
          </p>
        )}
      </section>
    </>
  );
}

function Block({
  title,
  span,
  children,
}: {
  title: string;
  span?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      className="panel"
      style={{ padding: 16, gridColumn: span ? "1 / -1" : undefined }}
    >
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 15,
          marginBottom: 10,
          color: "var(--fg)",
        }}
      >
        {title}
      </div>
      <div style={{ display: "grid", gap: 8 }}>{children}</div>
    </div>
  );
}

function Para({ text }: { text: string }) {
  if (!text) return <span className="faint" style={{ fontSize: 13 }}>（未提取到）</span>;
  return (
    <p style={{ fontSize: 13, lineHeight: 1.7, color: "var(--fg-dim)", margin: 0 }}>
      {text}
    </p>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  if (!v) return null;
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 13, lineHeight: 1.5 }}>
      <span className="faint" style={{ flexShrink: 0, minWidth: 62 }}>
        {k}
      </span>
      <span style={{ color: "var(--fg-dim)" }}>{v}</span>
    </div>
  );
}

function EntryList({
  label,
  items,
}: {
  label: string;
  items: { name: string; note: string }[];
}) {
  if (!items.length) return null;
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6 }}>
      <span className="faint">{label}</span>
      <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
        {items.map((e, i) => (
          <div key={i} style={{ color: "var(--fg-dim)" }}>
            <span style={{ color: "var(--fg)" }}>{e.name}</span>
            {e.note ? `：${e.note}` : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

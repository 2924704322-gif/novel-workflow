import type { StoryBible } from "@/lib/types";
import { EditableRow } from "./EditableRow";

export function BibleView({
  bible,
  onChange,
}: {
  bible: StoryBible;
  onChange: (b: StoryBible) => void;
}) {
  const set = (patch: Partial<StoryBible>) => onChange({ ...bible, ...patch });
  return (
    <div className="panel fadeup" style={{ padding: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <span className="seal seal--sm">典</span>
        <h3 style={{ fontSize: 18 }}>故事设定集</h3>
        <span className="faint" style={{ fontSize: 12, marginLeft: "auto" }}>
          可直接编辑
        </span>
      </div>
      <EditableRow
        label="故事内核"
        value={bible.logline}
        onChange={(v) => set({ logline: v })}
      />
      <EditableRow
        label="整体梗概"
        value={bible.synopsis}
        rows={5}
        onChange={(v) => set({ synopsis: v })}
      />
      <EditableRow
        label="世界观设定"
        value={bible.worldbuilding}
        rows={4}
        onChange={(v) => set({ worldbuilding: v })}
      />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <EditableRow
          label="核心主题"
          value={bible.themes}
          onChange={(v) => set({ themes: v })}
        />
        <EditableRow
          label="文风与视角"
          value={bible.tone}
          onChange={(v) => set({ tone: v })}
        />
      </div>

      <div className="label" style={{ marginBottom: 8 }}>
        主要人物
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {bible.characters.map((c, i) => (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "120px 96px 1fr auto",
              gap: 8,
              alignItems: "center",
            }}
          >
            <input
              className="input"
              value={c.name}
              onChange={(e) => {
                const cs = [...bible.characters];
                cs[i] = { ...c, name: e.target.value };
                set({ characters: cs });
              }}
            />
            <input
              className="input"
              value={c.role}
              onChange={(e) => {
                const cs = [...bible.characters];
                cs[i] = { ...c, role: e.target.value };
                set({ characters: cs });
              }}
            />
            <input
              className="input"
              value={c.profile}
              onChange={(e) => {
                const cs = [...bible.characters];
                cs[i] = { ...c, profile: e.target.value };
                set({ characters: cs });
              }}
            />
            <button
              className="btn btn--ghost btn--sm btn--danger"
              onClick={() =>
                set({ characters: bible.characters.filter((_, j) => j !== i) })
              }
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button
        className="btn btn--ghost btn--sm"
        style={{ marginTop: 10 }}
        onClick={() =>
          set({
            characters: [
              ...bible.characters,
              { name: "新角色", role: "配角", profile: "" },
            ],
          })
        }
      >
        + 添加人物
      </button>
    </div>
  );
}

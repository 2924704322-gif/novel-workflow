"use client";

import { uid } from "@/lib/client";
import {
  PROMPT_SOURCE_LABEL,
  type PromptEntry,
  type PromptSource,
  type Project,
} from "@/lib/types";

type Patch = (u: (p: Project) => Project) => void;

// 手动新增条目固定标为「主动编辑」；自动记录的条目沿用其来源标签，来源只读。
const SOURCE_CHIP: Record<PromptSource, string> = {
  manual: "chip chip--jade",
  bible: "chip",
  volumes: "chip",
  "chapter-outline": "chip",
  prose: "chip chip--cinnabar",
};

// ---------------------------------------------------------------------------
// PromptLibrary（提示词库）：每本书专属、可编辑的写作偏好 / 调整方向集合。
// 带方向的重新生成会自动记入并标明来源；后续正文生成时会一并参考已启用的条目。
// ---------------------------------------------------------------------------
export function PromptLibraryPanel({
  project,
  patch,
}: {
  project: Project;
  patch: Patch;
}) {
  const prompts = project.prompts || [];
  const activeCount = prompts.filter((p) => p.enabled && p.content.trim()).length;

  const update = (id: string, u: Partial<PromptEntry>) =>
    patch((p) => ({
      ...p,
      prompts: (p.prompts || []).map((e) =>
        e.id === id ? { ...e, ...u } : e
      ),
    }));

  const remove = (id: string) =>
    patch((p) => ({
      ...p,
      prompts: (p.prompts || []).filter((e) => e.id !== id),
    }));

  const add = () =>
    patch((p) => ({
      ...p,
      prompts: [
        {
          id: uid(),
          source: "manual" as PromptSource,
          content: "",
          note: "",
          enabled: true,
          createdAt: Date.now(),
        },
        ...(p.prompts || []),
      ],
    }));

  return (
    <div className="scroll-y" style={{ maxHeight: "70vh", paddingRight: 4 }}>
      <div className="codex-head">
        <div>
          <h3 style={{ fontSize: 17 }}>提示词库</h3>
          <p className="faint" style={{ fontSize: 12, marginTop: 2 }}>
            记录本书的写作偏好与历次「重新生成」的调整方向，并标明来源。已启用的条目会在后续正文生成时一并喂给模型参考。
          </p>
        </div>
        <span className="chip">{activeCount} 条生效</span>
      </div>

      {prompts.length === 0 && (
        <p className="muted" style={{ padding: "18px 4px", fontSize: 13 }}>
          还没有提示词。当你带方向重新生成故事设定集 / 分卷脉络 / 章节脉络 / 正文时，系统会自动把方向记入此处；你也可以手动添加长期生效的写作要求。
        </p>
      )}

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {prompts.map((e) => (
          <div
            key={e.id}
            className="panel"
            style={{ padding: 12, opacity: e.enabled ? 1 : 0.55 }}
          >
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <span className={SOURCE_CHIP[e.source]}>
                {PROMPT_SOURCE_LABEL[e.source]}
              </span>
              {e.note && (
                <span className="faint" style={{ fontSize: 11 }}>
                  {e.note}
                </span>
              )}
              <label
                className="faint"
                style={{
                  marginLeft: "auto",
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                }}
                title="是否在后续正文生成时参考这条提示词"
              >
                <input
                  type="checkbox"
                  checked={e.enabled}
                  onChange={(ev) => update(e.id, { enabled: ev.target.checked })}
                />
                参考
              </label>
              <button
                className="btn btn--ghost btn--sm btn--danger"
                onClick={() => remove(e.id)}
              >
                ×
              </button>
            </div>
            <textarea
              className="textarea"
              rows={2}
              style={{ marginTop: 8, fontSize: 13 }}
              value={e.content}
              placeholder="写作偏好 / 调整方向，例：多写打斗细节、放慢节奏、强化人物内心戏……"
              onChange={(ev) => update(e.id, { content: ev.target.value })}
            />
          </div>
        ))}
      </div>

      <button
        className="btn btn--ghost btn--sm"
        style={{ marginTop: 12 }}
        onClick={add}
      >
        + 添加提示词
      </button>
    </div>
  );
}

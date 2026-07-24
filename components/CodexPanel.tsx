"use client";

import { uid } from "@/lib/client";
import {
  CODEX_CATEGORIES,
  FORESHADOW_STATUS_LABEL,
  type CodexCategory,
  type CodexEntry,
  type Foreshadow,
  type ForeshadowStatus,
  type Project,
} from "@/lib/types";

type Patch = (u: (p: Project) => Project) => void;

// ---------------------------------------------------------------------------
// Codex（信息库 / 世界档案）：随剧情增长、可检索、可手动编辑的事实基准。
// ---------------------------------------------------------------------------
export function CodexPanel({
  project,
  patch,
}: {
  project: Project;
  patch: Patch;
}) {
  const codex = project.codex || [];

  const update = (id: string, u: Partial<CodexEntry>) =>
    patch((p) => ({
      ...p,
      codex: p.codex.map((e) => (e.id === id ? { ...e, ...u } : e)),
    }));

  const remove = (id: string) =>
    patch((p) => ({ ...p, codex: p.codex.filter((e) => e.id !== id) }));

  const add = () =>
    patch((p) => ({
      ...p,
      codex: [
        {
          id: uid(),
          category: "人物" as CodexCategory,
          name: "新条目",
          aliases: [],
          summary: "",
          updatedAtChapter: 0,
        },
        ...p.codex,
      ],
    }));

  return (
    <div className="scroll-y" style={{ maxHeight: "70vh", paddingRight: 4 }}>
      <div className="codex-head">
        <div>
          <h3 style={{ fontSize: 17 }}>设定库 · 世界档案</h3>
          <p className="faint" style={{ fontSize: 12, marginTop: 2 }}>
            写作时按本章细纲自动检索相关条目喂给模型，保持跨卷一致。可标注存续状态、置顶核心条目。
          </p>
        </div>
        <span className="chip">{codex.length} 条</span>
      </div>

      {codex.length === 0 && (
        <p className="muted" style={{ padding: "18px 4px", fontSize: 13 }}>
          还没有档案。随着章节写作，系统会自动抽取人物、地点、物品等关键信息入库；你也可以手动添加。
        </p>
      )}

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {codex.map((e) => (
          <div key={e.id} className="panel" style={{ padding: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "96px 1fr auto",
                gap: 8,
                alignItems: "center",
              }}
            >
              <select
                className="select"
                value={e.category}
                onChange={(ev) =>
                  update(e.id, { category: ev.target.value as CodexCategory })
                }
              >
                {CODEX_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                className="input"
                value={e.name}
                placeholder="名称"
                onChange={(ev) => update(e.id, { name: ev.target.value })}
              />
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                {e.updatedAtChapter > 0 && (
                  <span className="faint" style={{ fontSize: 11 }}>
                    第{e.updatedAtChapter}章
                  </span>
                )}
                <button
                  className="btn btn--ghost btn--sm btn--danger"
                  onClick={() => remove(e.id)}
                >
                  ×
                </button>
              </div>
            </div>
            <input
              className="input"
              style={{ marginTop: 8, fontSize: 12.5 }}
              value={(e.aliases || []).join("、")}
              placeholder="别名 / 绰号（用、或，分隔，用于检索命中）"
              onChange={(ev) =>
                update(e.id, {
                  aliases: ev.target.value
                    .split(/[、,，]/)
                    .map((x) => x.trim())
                    .filter(Boolean),
                })
              }
            />
            <textarea
              className="textarea"
              rows={2}
              style={{ marginTop: 8, fontSize: 13 }}
              value={e.summary}
              placeholder="当前状态与关键信息"
              onChange={(ev) => update(e.id, { summary: ev.target.value })}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 8,
                marginTop: 8,
                alignItems: "center",
              }}
            >
              <input
                className="input"
                style={{ fontSize: 12.5 }}
                value={e.status || ""}
                placeholder="存续状态：存活 / 死亡 / 失踪 / 重伤…（死亡等状态写作时不得擅自推翻）"
                onChange={(ev) => update(e.id, { status: ev.target.value })}
              />
              <label
                className="faint"
                style={{
                  fontSize: 12,
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
                title="核心条目：写作时恒定注入模型（主角/关键设定），不受本章是否点名限制"
              >
                <input
                  type="checkbox"
                  checked={Boolean(e.pinned)}
                  onChange={(ev) => update(e.id, { pinned: ev.target.checked })}
                />
                核心·恒定注入
              </label>
            </div>
            {(e.events || []).length > 0 && (
              <div
                className="faint"
                style={{
                  marginTop: 8,
                  fontSize: 12,
                  lineHeight: 1.6,
                  borderTop: "1px dashed var(--ink-600, rgba(255,255,255,0.1))",
                  paddingTop: 6,
                }}
              >
                <b style={{ color: "var(--fg-dim)" }}>状态历程</b>
                <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
                  {(e.events || []).map((v, i) => (
                    <li key={i}>
                      第{v.chapter}章：{v.note}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        className="btn btn--ghost btn--sm"
        style={{ marginTop: 12 }}
        onClick={add}
      >
        + 添加条目
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Foreshadow（伏笔线索）：埋设 → 强化 → 回收 / 废弃 的全生命周期跟踪。
// ---------------------------------------------------------------------------
const STATUS_ORDER: ForeshadowStatus[] = [
  "planted",
  "reinforced",
  "paid",
  "abandoned",
];

export function ForeshadowPanel({
  project,
  patch,
}: {
  project: Project;
  patch: Patch;
}) {
  const items = project.foreshadows || [];
  const open = items.filter(
    (f) => f.status === "planted" || f.status === "reinforced"
  ).length;

  const update = (id: string, u: Partial<Foreshadow>) =>
    patch((p) => ({
      ...p,
      foreshadows: p.foreshadows.map((f) => (f.id === id ? { ...f, ...u } : f)),
    }));

  const remove = (id: string) =>
    patch((p) => ({
      ...p,
      foreshadows: p.foreshadows.filter((f) => f.id !== id),
    }));

  const add = () =>
    patch((p) => ({
      ...p,
      foreshadows: [
        {
          id: uid(),
          title: "新伏笔",
          detail: "",
          status: "planted" as ForeshadowStatus,
          plantedAt: 0,
          payoffPlan: "",
          paidAt: 0,
        },
        ...p.foreshadows,
      ],
    }));

  return (
    <div className="scroll-y" style={{ maxHeight: "70vh", paddingRight: 4 }}>
      <div className="codex-head">
        <div>
          <h3 style={{ fontSize: 17 }}>伏笔线索</h3>
          <p className="faint" style={{ fontSize: 12, marginTop: 2 }}>
            未回收的伏笔会在写作时提醒模型铺垫或回收，避免挖坑不填、前后矛盾。
          </p>
        </div>
        <span className="chip">{open} 条待回收</span>
      </div>

      {items.length === 0 && (
        <p className="muted" style={{ padding: "18px 4px", fontSize: 13 }}>
          还没有伏笔。写作归档时系统会自动记录新埋设/回收的伏笔；也可手动登记你想埋下的线索。
        </p>
      )}

      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {items.map((f) => (
          <div key={f.id} className="panel" style={{ padding: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 110px auto",
                gap: 8,
                alignItems: "center",
              }}
            >
              <input
                className="input"
                value={f.title}
                placeholder="伏笔简述"
                onChange={(ev) => update(f.id, { title: ev.target.value })}
              />
              <select
                className="select"
                value={f.status}
                onChange={(ev) =>
                  update(f.id, { status: ev.target.value as ForeshadowStatus })
                }
              >
                {STATUS_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {FORESHADOW_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
              <button
                className="btn btn--ghost btn--sm btn--danger"
                onClick={() => remove(f.id)}
              >
                ×
              </button>
            </div>
            <textarea
              className="textarea"
              rows={2}
              style={{ marginTop: 8, fontSize: 13 }}
              value={f.detail}
              placeholder="具体线索 / 内容"
              onChange={(ev) => update(f.id, { detail: ev.target.value })}
            />
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 90px 90px",
                gap: 8,
                marginTop: 8,
                alignItems: "center",
              }}
            >
              <input
                className="input"
                style={{ fontSize: 12.5 }}
                value={f.payoffPlan}
                placeholder="计划如何回收"
                onChange={(ev) => update(f.id, { payoffPlan: ev.target.value })}
              />
              <label className="faint" style={{ fontSize: 11 }}>
                埋设章
                <input
                  className="input"
                  type="number"
                  min={0}
                  style={{ marginTop: 2, fontSize: 12 }}
                  value={f.plantedAt}
                  onChange={(ev) =>
                    update(f.id, { plantedAt: parseInt(ev.target.value) || 0 })
                  }
                />
              </label>
              <label className="faint" style={{ fontSize: 11 }}>
                回收章
                <input
                  className="input"
                  type="number"
                  min={0}
                  style={{ marginTop: 2, fontSize: 12 }}
                  value={f.paidAt}
                  onChange={(ev) =>
                    update(f.id, { paidAt: parseInt(ev.target.value) || 0 })
                  }
                />
              </label>
            </div>
          </div>
        ))}
      </div>

      <button
        className="btn btn--ghost btn--sm"
        style={{ marginTop: 12 }}
        onClick={add}
      >
        + 添加伏笔
      </button>
    </div>
  );
}

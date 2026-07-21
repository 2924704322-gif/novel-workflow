"use client";

import { useRef, useState } from "react";
import { loadConfig, streamPost, uid } from "@/lib/client";
import { extractJson } from "@/lib/prompts";
import { RATING_OPTIONS } from "@/lib/types";
import type {
  Chapter,
  Project,
  ProjectSetup,
  StoryBible,
  Volume,
} from "@/lib/types";

interface OutlineJson {
  title?: string;
  bible: StoryBible;
  volumes: { title: string; summary: string; chapterCount?: number }[];
}

export default function StepOutline({
  project,
  patch,
  goWriting,
}: {
  project: Project;
  patch: (u: (p: Project) => Project) => void;
  goWriting: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [stream, setStream] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [expanding, setExpanding] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const s = project.setup;
  const setSetup = (patchSetup: Partial<ProjectSetup>) =>
    patch((p) => ({ ...p, setup: { ...p.setup, ...patchSetup } }));

  async function generateOutline() {
    const cfg = loadConfig();
    if (!cfg.apiKey) {
      setError("尚未配置模型接口，请先到「接口设置」填写。");
      return;
    }
    setError(null);
    setBusy(true);
    setStream("");
    abortRef.current = new AbortController();
    try {
      const full = await streamPost(
        "/api/generate/outline",
        { config: cfg, setup: s },
        (t) => setStream(t),
        abortRef.current.signal
      );
      const data = extractJson<OutlineJson>(full);
      const volumes: Volume[] = data.volumes.map((v, i) => ({
        id: uid(),
        index: i + 1,
        title: v.title || `第${i + 1}卷`,
        summary: v.summary || "",
        plannedChapters: Math.max(1, Math.round(v.chapterCount || 20)),
        chapters: [],
      }));
      patch((p) => ({
        ...p,
        title: data.title && p.title === "未命名作品" ? data.title : p.title,
        phase: "outline",
        bible: data.bible,
        volumes,
      }));
    } catch (e) {
      setError(
        (e instanceof Error ? e.message : "生成失败") +
          "（可重试；若模型未返回规范 JSON，可再生成一次）"
      );
    } finally {
      setBusy(false);
      setStream("");
    }
  }

  async function expandVolume(vol: Volume) {
    const cfg = loadConfig();
    if (!cfg.apiKey || !project.bible) return;
    setExpanding(vol.id);
    setError(null);
    try {
      const full = await streamPost(
        "/api/generate/volume",
        {
          config: cfg,
          setup: s,
          bible: project.bible,
          volume: vol,
          chapterCount: vol.plannedChapters,
        },
        () => {}
      );
      const data = extractJson<{
        chapters: { title: string; synopsis: string }[];
      }>(full);
      patch((p) => ({
        ...p,
        volumes: p.volumes.map((v) =>
          v.id === vol.id
            ? {
                ...v,
                chapters: data.chapters.map((c, i) => ({
                  id: uid(),
                  index: i + 1,
                  title: c.title || `第${i + 1}章`,
                  synopsis: c.synopsis || "",
                  content: "",
                  summary: "",
                  wordCount: 0,
                  status: "empty" as const,
                  updatedAt: Date.now(),
                })),
              }
            : v
        ),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "展开章节失败");
    } finally {
      setExpanding(null);
    }
  }

  function addVolume() {
    patch((p) => ({
      ...p,
      volumes: [
        ...p.volumes,
        {
          id: uid(),
          index: p.volumes.length + 1,
          title: `第${p.volumes.length + 1}卷`,
          summary: "",
          plannedChapters: 20,
          chapters: [],
        },
      ],
    }));
  }

  function deleteVolume(id: string) {
    patch((p) => ({
      ...p,
      volumes: p.volumes
        .filter((v) => v.id !== id)
        .map((v, i) => ({ ...v, index: i + 1 })),
    }));
  }

  const bible = project.bible;
  const anyChapters = project.volumes.some((v) => v.chapters.length > 0);

  return (
    <main className="shell" style={{ paddingTop: 28, paddingBottom: 90 }}>
      <div className="outline-grid">
        {/* Left: setup form */}
        <section className="panel" style={{ padding: 22, alignSelf: "start" }}>
          <h3 style={{ fontSize: 17, marginBottom: 4 }}>创作设定</h3>
          <p className="faint" style={{ fontSize: 12, marginBottom: 18 }}>
            信息越具体，大纲越贴合你的构想。
          </p>

          <Field label="题材类型">
            <input
              className="input"
              value={s.genre}
              onChange={(e) => setSetup({ genre: e.target.value })}
              placeholder="东方玄幻 / 都市 / 科幻…"
            />
          </Field>
          <Field label="核心灵感 / 一句话设定">
            <textarea
              className="textarea"
              rows={3}
              value={s.premise}
              onChange={(e) => setSetup({ premise: e.target.value })}
              placeholder="一个失去记忆的剑客，在追查身世的路上卷入王朝棋局…"
            />
          </Field>
          <Field label="主角设定">
            <textarea
              className="textarea"
              rows={2}
              value={s.protagonist}
              onChange={(e) => setSetup({ protagonist: e.target.value })}
              placeholder="姓名、身份、性格、金手指或目标"
            />
          </Field>
          <Field label="期望文风">
            <input
              className="input"
              value={s.style}
              onChange={(e) => setSetup({ style: e.target.value })}
              placeholder="爽文快节奏 / 古典细腻 / 冷硬悬疑…"
            />
          </Field>
          <Field label="题材基调 / 内容分级">
            <select
              className="select"
              value={s.rating || "全年龄向"}
              onChange={(e) => setSetup({ rating: e.target.value })}
            >
              {RATING_OPTIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <span className="hint">
              据此向模型声明创作定位，减少正常虚构剧情被误判。请在平台规范与法律法规允许范围内创作。
              {(s.rating || "").includes("R18") &&
                " 　注：R18 能否落地取决于所选模型 / 接口——请在「接口设置」指向允许成人内容的模型（如自建或不严格审查的服务），否则可能被服务商拒绝。"}
            </span>
          </Field>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Field label="目标总字数">
              <input
                className="input"
                type="number"
                step={50000}
                value={s.targetWords}
                onChange={(e) =>
                  setSetup({ targetWords: parseInt(e.target.value) || 0 })
                }
              />
            </Field>
            <Field label="单章字数">
              <input
                className="input"
                type="number"
                step={500}
                value={s.wordsPerChapter}
                onChange={(e) =>
                  setSetup({ wordsPerChapter: parseInt(e.target.value) || 0 })
                }
              />
            </Field>
          </div>
          <Field label="预设总章节数（可选）">
            <input
              className="input"
              type="number"
              min={0}
              step={10}
              value={s.targetChapters ?? 0}
              onChange={(e) =>
                setSetup({ targetChapters: parseInt(e.target.value) || 0 })
              }
            />
            <span className="hint">
              填 0 = 依据目标字数自动规划；填入具体数值，则生成大纲时会让各卷章节数之和贴近该值；之后也可在右侧分卷里逐卷调整。
            </span>
          </Field>
          <Field label="其他要求（可选）">
            <textarea
              className="textarea"
              rows={2}
              value={s.extra}
              onChange={(e) => setSetup({ extra: e.target.value })}
              placeholder="需要规避的桥段、必须出现的设定等"
            />
          </Field>

          <Field label="文笔调校">
            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                cursor: "pointer",
                fontSize: 13,
                color: "var(--fg)",
              }}
            >
              <input
                type="checkbox"
                checked={s.deAi ?? true}
                onChange={(e) => setSetup({ deAi: e.target.checked })}
              />
              启用“去 AI 味”增强
            </label>
            <span className="hint">
              向模型注入反套路指令：避免对仗强行升华、段末抒情、空泛形容词与网文/AI 陈词，多用具体细节与有潜台词的对话。
            </span>
          </Field>
          <Field label="负面清单（可选，每行一条）">
            <textarea
              className="textarea"
              rows={3}
              value={s.bannedList || ""}
              onChange={(e) => setSetup({ bannedList: e.target.value })}
              placeholder={"必须回避的词语 / 句式 / 桥段，例如：\n嘴角勾起一抹弧度\n不是…而是…\n五味杂陈"}
            />
            <span className="hint">
              此处列出的内容会在每章创作时作为禁用项一并传给模型。
            </span>
          </Field>

          <button
            className="btn btn--primary"
            style={{ width: "100%", marginTop: 6 }}
            onClick={generateOutline}
            disabled={busy}
          >
            {busy ? "正在构思大纲…" : bible ? "重新生成大纲" : "生成整体大纲"}
          </button>
          {busy && (
            <button
              className="btn btn--ghost btn--sm"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => abortRef.current?.abort()}
            >
              中止
            </button>
          )}
          {error && (
            <p
              className="chip chip--cinnabar"
              style={{ marginTop: 12, display: "block", padding: "10px 12px", lineHeight: 1.5 }}
            >
              {error}
            </p>
          )}
        </section>

        {/* Right: outline result */}
        <section style={{ minWidth: 0 }}>
          {busy && stream && (
            <div className="panel" style={{ padding: 20, marginBottom: 18 }}>
              <div className="chip chip--cinnabar" style={{ marginBottom: 12 }}>
                构思中
              </div>
              <pre
                className="scroll-y writing-cursor"
                style={{
                  maxHeight: 260,
                  whiteSpace: "pre-wrap",
                  fontSize: 12.5,
                  lineHeight: 1.6,
                  color: "var(--fg-dim)",
                  fontFamily: "var(--font-sans)",
                  margin: 0,
                }}
              >
                {stream}
              </pre>
            </div>
          )}

          {!bible && !busy && (
            <div
              className="panel"
              style={{ padding: "60px 30px", textAlign: "center" }}
            >
              <div className="seal" style={{ margin: "0 auto 18px" }}>
                纲
              </div>
              <h3 style={{ fontSize: 19, marginBottom: 8 }}>先立一份全局大纲</h3>
              <p className="muted" style={{ maxWidth: 380, margin: "0 auto" }}>
                填好左侧设定后点击「生成整体大纲」。系统会先给出故事内核、世界观、人物与分卷脉络，你可逐项修改，再展开到章节。
              </p>
            </div>
          )}

          {bible && (
            <BibleView
              bible={bible}
              onChange={(b) => patch((p) => ({ ...p, bible: b }))}
            />
          )}

          {bible && (
            <div style={{ marginTop: 24 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  marginBottom: 12,
                  gap: 12,
                }}
              >
                <h3 style={{ fontSize: 18 }}>分卷脉络</h3>
                <span className="faint" style={{ fontSize: 13, marginLeft: "auto" }}>
                  共 {project.volumes.length} 卷 · 计划{" "}
                  {project.volumes.reduce((a, v) => a + v.plannedChapters, 0)} 章
                </span>
                <button className="btn btn--ghost btn--sm" onClick={addVolume}>
                  + 新增分卷
                </button>
              </div>

              {project.volumes.length === 0 ? (
                <div
                  className="panel"
                  style={{ padding: "22px", textAlign: "center" }}
                >
                  <p className="muted" style={{ margin: 0 }}>
                    还没有分卷。点「+ 新增分卷」手动添加，或重新生成大纲。
                  </p>
                </div>
              ) : (
                <div style={{ display: "grid", gap: 12 }}>
                  {project.volumes.map((v) => (
                    <VolumeCard
                      key={v.id}
                      volume={v}
                      expanding={expanding === v.id}
                      onExpand={() => expandVolume(v)}
                      onDelete={() => deleteVolume(v.id)}
                      onChange={(nv) =>
                        patch((p) => ({
                          ...p,
                          volumes: p.volumes.map((x) =>
                            x.id === nv.id ? nv : x
                          ),
                        }))
                      }
                    />
                  ))}
                </div>
              )}

              {anyChapters && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "flex-end",
                    marginTop: 22,
                  }}
                >
                  <button
                    className="btn btn--primary"
                    onClick={() => {
                      patch((p) => ({ ...p, phase: "writing" }));
                      goWriting();
                    }}
                  >
                    进入正文创作 →
                  </button>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="field" style={{ marginBottom: 14 }}>
      <span className="label">{label}</span>
      {children}
    </div>
  );
}

function EditableRow({
  label,
  value,
  rows = 2,
  onChange,
}: {
  label: string;
  value: string;
  rows?: number;
  onChange: (v: string) => void;
}) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div className="label" style={{ marginBottom: 6 }}>
        {label}
      </div>
      <textarea
        className="textarea"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function BibleView({
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

function VolumeCard({
  volume,
  expanding,
  onExpand,
  onDelete,
  onChange,
}: {
  volume: Volume;
  expanding: boolean;
  onExpand: () => void;
  onDelete: () => void;
  onChange: (v: Volume) => void;
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
                <div
                  key={c.id}
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
                      第 {i + 1} 章
                    </span>
                    {c.content && (
                      <span
                        className="chip chip--jade"
                        title="本章已有正文，编辑脉络不会删除正文"
                      >
                        {c.status === "done" ? "已完成" : "有草稿"} · {c.wordCount} 字
                      </span>
                    )}
                    <span
                      style={{ marginLeft: "auto", display: "flex", gap: 4 }}
                    >
                      <button
                        className="btn btn--ghost btn--sm"
                        title="上移"
                        disabled={i === 0}
                        onClick={() => moveChapter(c.id, -1)}
                      >
                        ↑
                      </button>
                      <button
                        className="btn btn--ghost btn--sm"
                        title="下移"
                        disabled={i === volume.chapters.length - 1}
                        onClick={() => moveChapter(c.id, 1)}
                      >
                        ↓
                      </button>
                      <button
                        className="btn btn--ghost btn--sm btn--danger"
                        title="删除本章"
                        onClick={() => deleteChapter(c.id)}
                      >
                        ×
                      </button>
                    </span>
                  </div>
                  <input
                    className="input"
                    value={c.title}
                    placeholder="本章标题"
                    onChange={(e) =>
                      updateChapter(c.id, { title: e.target.value })
                    }
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontWeight: 600,
                    }}
                  />
                  <textarea
                    className="textarea"
                    rows={2}
                    value={c.synopsis}
                    placeholder="本章脉络：关键事件、人物行动、情绪转折、章末悬念"
                    onChange={(e) =>
                      updateChapter(c.id, { synopsis: e.target.value })
                    }
                    style={{ marginTop: 6, fontSize: 13 }}
                  />
                </div>
              ))}
            </div>
          )}

          <button
            className="btn btn--ghost btn--sm"
            style={{ marginTop: 10 }}
            onClick={addChapter}
          >
            + 添加一章
          </button>
        </div>
      )}
    </div>
  );
}

"use client";

// DEPRECATED（v5.2 新主界面重构）：旧三步走「大纲」步骤组件，已无活跃路由引用。
// 新入口为 components/studio/* 的对话式创作（ChatStudio + HitlMdCard 落稿闭环）。
// 保留原因：旧工程参考 + 可能的回退需要；请勿在新代码中引用本组件。

import { useEffect, useRef, useState } from "react";
import {
  fetchStyleCards,
  loadConfig,
  loadReconcilePref,
  requestReconcile,
  streamPost,
  uid,
} from "@/lib/client";
import { extractJson } from "@/lib/prompts";
import {
  applyReconcile,
  collectDownstream,
  hasReconcileContent,
} from "@/lib/reconcile";
import type {
  CollectOptions,
  ReconcileChange,
} from "@/lib/reconcile";
import { ChangeSummary, type ReconcileState } from "./ChangeSummary";
import {
  StepNav,
  StreamingPanel,
  ErrorNote,
  Field,
  RegenDialog,
  EditableRow,
  BibleView,
  VolumeCard,
} from "./step-outline/";
import { RATING_OPTIONS, recordPromptEntry } from "@/lib/types";
import type {
  Chapter,
  Project,
  ProjectSetup,
  StoryBible,
  StyleCard,
  Volume,
} from "@/lib/types";

interface BibleJson {
  title?: string;
  bible: StoryBible;
}
interface VolumesJson {
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
  // 重新生成方向对话框：点「重新生成」先问方向，确认后再带方向重生。
  type RegenAction =
    | { kind: "bible" }
    | { kind: "volumes" }
    | { kind: "chapter-regen"; volId: string; chapterId: string };
  const [regenAction, setRegenAction] = useState<RegenAction | null>(null);
  const [regenDir, setRegenDir] = useState("");
  // 章节脉络重生 / 续写的进行中标记：{ volId, chapterId }（chapterId 为 null 表示续写下一章）。
  const [outlineBusy, setOutlineBusy] = useState<{
    volId: string;
    chapterId: string | null;
  } | null>(null);
  // 重新生成结束后的「一致性统一」状态（变更摘要卡片）。
  const [reconcile, setReconcile] = useState<ReconcileState>({
    busy: false,
    result: null,
  });

  // 在某次重生后，收集受影响的下游内容并请模型统一，自动写回并展示摘要。
  // baseProject 需已包含本次改动（规避 patch 的异步性）。
  async function runReconcile(
    baseProject: Project,
    change: ReconcileChange,
    opts: CollectOptions
  ) {
    if (!loadReconcilePref()) return;
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
  function openRegen(target: "bible" | "volumes") {
    setRegenDir("");
    setRegenAction({ kind: target });
  }
  function openRegenChapter(volId: string, chapterId: string) {
    setRegenDir("");
    setRegenAction({ kind: "chapter-regen", volId, chapterId });
  }
  function confirmRegen() {
    const a = regenAction;
    const dir = regenDir.trim() || undefined;
    setRegenAction(null);
    if (!a) return;
    if (a.kind === "bible") generateBible(dir);
    else if (a.kind === "volumes") generateVolumes(dir);
    else if (a.kind === "chapter-regen")
      regenChapterOutline(a.volId, a.chapterId, dir);
  }
  // The outline phase is a 3-step wizard; land on the furthest reached step.
  const [subStep, setSubStep] = useState<1 | 2 | 3>(
    project.volumes.length > 0 ? 3 : project.bible ? 2 : 1
  );
  // Style cards prepared in the style workshop; offered as an optional pick.
  const [styleCards, setStyleCards] = useState<StyleCard[]>([]);
  useEffect(() => {
    fetchStyleCards()
      .then(setStyleCards)
      .catch(() => {});
  }, []);

  const s = project.setup;
  const setSetup = (patchSetup: Partial<ProjectSetup>) =>
    patch((p) => ({ ...p, setup: { ...p.setup, ...patchSetup } }));

  // 多选文风卡：优先用 styleCards，回退到旧版单张 styleCard（兼容老作品）。
  const selectedStyleCards: StyleCard[] = s.styleCards?.length
    ? s.styleCards
    : s.styleCard
    ? [s.styleCard]
    : [];
  const selectedStyleHashes = new Set(
    selectedStyleCards.map((c) => c.sourceFileHash)
  );
  const toggleStyleCard = (card: StyleCard) => {
    const next = selectedStyleHashes.has(card.sourceFileHash)
      ? selectedStyleCards.filter((c) => c.sourceFileHash !== card.sourceFileHash)
      : [...selectedStyleCards, card];
    // 写入 styleCards、清空旧版单张字段，避免两者重复计入。
    setSetup({ styleCards: next, styleCard: null });
  };

  // Step 2: generate the story bible only (no volumes).
  async function generateBible(direction?: string) {
    const cfg = loadConfig();
    if (!cfg.apiKey) {
      setError("尚未配置模型接口，请先到「接口设置」填写。");
      return;
    }
    // 已存在设定集 = 本次是「重新生成」，完成后需级联统一下游内容。
    const wasRegen = Boolean(project.bible);
    setError(null);
    setBusy(true);
    setStream("");
    abortRef.current = new AbortController();
    try {
      const full = await streamPost(
        "/api/generate/bible",
        { config: cfg, setup: s, direction },
        (t) => setStream(t),
        abortRef.current.signal
      );
      const data = extractJson<BibleJson>(full);
      const nextTitle =
        data.title && project.title === "未命名作品" ? data.title : project.title;
      patch((p) => ({
        ...p,
        title: data.title && p.title === "未命名作品" ? data.title : p.title,
        phase: "outline",
        bible: data.bible,
      }));
      // 带方向的重生 = 一条写作诉求，记入提示词库（标明来自故事设定集）。
      if (direction && direction.trim()) {
        patch((p) => recordPromptEntry(p, "bible", direction));
      }
      if (wasRegen) {
        const updated: Project = {
          ...project,
          title: nextTitle,
          phase: "outline",
          bible: data.bible,
        };
        const detail = [
          data.bible.logline && `一句话设定：${data.bible.logline}`,
          data.bible.synopsis && `故事梗概：${data.bible.synopsis}`,
          data.bible.tone && `整体基调：${data.bible.tone}`,
        ]
          .filter(Boolean)
          .join("\n\n");
        await runReconcile(
          updated,
          {
            origin: "bible",
            label: "故事设定集已重新生成",
            detail,
            direction,
          },
          { includeAllVolumes: true }
        );
      }
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

  // Step 3: plan the volume-level outline from the finalized bible.
  async function generateVolumes(direction?: string) {
    const cfg = loadConfig();
    if (!cfg.apiKey || !project.bible) {
      setError("请先在上一步生成并确认「故事设定集」。");
      return;
    }
    setError(null);
    setBusy(true);
    setStream("");
    abortRef.current = new AbortController();
    try {
      const full = await streamPost(
        "/api/generate/volumes",
        { config: cfg, setup: s, bible: project.bible, direction },
        (t) => setStream(t),
        abortRef.current.signal
      );
      const data = extractJson<VolumesJson>(full);
      const volumes: Volume[] = data.volumes.map((v, i) => ({
        id: uid(),
        index: i + 1,
        title: v.title || `第${i + 1}卷`,
        summary: v.summary || "",
        plannedChapters: Math.max(1, Math.round(v.chapterCount || 20)),
        chapters: [],
      }));
      patch((p) => ({ ...p, phase: "outline", volumes }));
      // 带方向的重生 → 记入提示词库（标明来自分卷脉络）。
      if (direction && direction.trim()) {
        patch((p) => recordPromptEntry(p, "volumes", direction));
      }
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

  // 本卷首章在全书中的起始序号（用于脉络提示词里的章号显示）。
  function volumeGlobalStart(volId: string): number {
    let n = 1;
    for (const v of project.volumes) {
      if (v.id === volId) break;
      n += v.chapters.length;
    }
    return n;
  }

  // 重新生成单一章节的脉络（保留已有正文）。
  async function regenChapterOutline(
    volId: string,
    chapterId: string,
    direction?: string
  ) {
    const cfg = loadConfig();
    if (!cfg.apiKey || !project.bible) {
      setError("尚未配置模型接口，或尚未生成故事设定集。");
      return;
    }
    const vol = project.volumes.find((v) => v.id === volId);
    const target = vol?.chapters.find((c) => c.id === chapterId);
    if (!vol || !target) return;
    setOutlineBusy({ volId, chapterId });
    setError(null);
    try {
      const full = await streamPost(
        "/api/generate/chapter-outline",
        {
          config: cfg,
          setup: s,
          bible: project.bible,
          volume: vol,
          mode: "regen",
          targetIndex: target.index,
          globalStart: volumeGlobalStart(volId),
          direction,
        },
        () => {}
      );
      const data = extractJson<{ title?: string; synopsis?: string }>(full);
      const newTitle = data.title?.trim() || target.title;
      const newSynopsis = data.synopsis?.trim() || target.synopsis;
      patch((p) => ({
        ...p,
        volumes: p.volumes.map((v) =>
          v.id === volId
            ? {
                ...v,
                chapters: v.chapters.map((c) =>
                  c.id === chapterId
                    ? {
                        ...c,
                        title: data.title?.trim() || c.title,
                        synopsis: data.synopsis?.trim() || c.synopsis,
                        updatedAt: Date.now(),
                      }
                    : c
                ),
              }
            : v
        ),
      }));
      // 本章脉络已变 → 对其之后的章节做一致性统一。
      const globalNo = volumeGlobalStart(volId) + target.index - 1;
      // 带方向的重生 → 记入提示词库（标明来自章节脉络）。
      if (direction && direction.trim()) {
        patch((p) =>
          recordPromptEntry(p, "chapter-outline", direction, `第${globalNo}章`)
        );
      }
      const updated: Project = {
        ...project,
        volumes: project.volumes.map((v) =>
          v.id === volId
            ? {
                ...v,
                chapters: v.chapters.map((c) =>
                  c.id === chapterId
                    ? {
                        ...c,
                        title: newTitle,
                        synopsis: newSynopsis,
                        updatedAt: Date.now(),
                      }
                    : c
                ),
              }
            : v
        ),
      };
      await runReconcile(
        updated,
        {
          origin: "chapter-outline",
          label: `第${globalNo}章脉络已重新生成`,
          detail: `第${globalNo}章《${newTitle}》最新脉络：\n${newSynopsis}`,
          direction,
        },
        { fromGlobal: globalNo + 1 }
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "重生本章脉络失败");
    } finally {
      setOutlineBusy(null);
    }
  }

  // 根据上下文续写本卷的下一章脉络（追加到末尾）。
  async function genNextChapterOutline(volId: string) {
    const cfg = loadConfig();
    if (!cfg.apiKey || !project.bible) {
      setError("尚未配置模型接口，或尚未生成故事设定集。");
      return;
    }
    const vol = project.volumes.find((v) => v.id === volId);
    if (!vol) return;
    setOutlineBusy({ volId, chapterId: null });
    setError(null);
    try {
      const full = await streamPost(
        "/api/generate/chapter-outline",
        {
          config: cfg,
          setup: s,
          bible: project.bible,
          volume: vol,
          mode: "next",
          globalStart: volumeGlobalStart(volId),
        },
        () => {}
      );
      const data = extractJson<{ title?: string; synopsis?: string }>(full);
      patch((p) => ({
        ...p,
        volumes: p.volumes.map((v) =>
          v.id === volId
            ? {
                ...v,
                chapters: [
                  ...v.chapters,
                  {
                    id: uid(),
                    index: v.chapters.length + 1,
                    title: data.title?.trim() || `第${v.chapters.length + 1}章`,
                    synopsis: data.synopsis?.trim() || "",
                    content: "",
                    summary: "",
                    wordCount: 0,
                    status: "empty" as const,
                    updatedAt: Date.now(),
                  },
                ],
              }
            : v
        ),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "续写下一章脉络失败");
    } finally {
      setOutlineBusy(null);
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
  const canStep2 = Boolean(s.premise.trim() || s.genre.trim());
  const canStep3 = Boolean(bible);

  return (
    <main className="shell" style={{ paddingTop: 28, paddingBottom: 90 }}>
      <StepNav
        current={subStep}
        canStep2={canStep2}
        canStep3={canStep3}
        step1Done={canStep2}
        step2Done={canStep3}
        step3Done={anyChapters}
        go={(n) => setSubStep(n)}
      />

      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <ChangeSummary
          state={reconcile}
          onDismiss={() => setReconcile({ busy: false, result: null })}
        />
      </div>

      {/* Step 1 — 创作设定 */}
      {subStep === 1 && (
        <section
          className="panel fadeup"
          style={{ padding: 24, maxWidth: 720, margin: "0 auto" }}
        >
          <h3 style={{ fontSize: 18, marginBottom: 4 }}>第一步 · 创作设定</h3>
          <p className="faint" style={{ fontSize: 12, marginBottom: 18 }}>
            信息越具体，后面生成的设定集与分卷越贴合你的构想。
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
          <Field label="文风卡（可选·可多选）">
            {styleCards.length === 0 ? (
              <span className="hint">
                还没有文风卡。可先到「拆书工坊」上传范文拆解文风（或自定义一张），生成的文风卡会自动保存并在此处可选。
              </span>
            ) : (
              <>
                <div style={{ display: "grid", gap: 6, marginBottom: 4 }}>
                  {styleCards.map((c) => {
                    const checked = selectedStyleHashes.has(c.sourceFileHash);
                    return (
                      <label
                        key={c.sourceFileHash}
                        style={{
                          display: "flex",
                          gap: 8,
                          alignItems: "center",
                          fontSize: 13,
                          cursor: "pointer",
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleStyleCard(c)}
                        />
                        <span>
                          {c.styleName}
                          <span className="faint">（{c.sourceFileName}）</span>
                        </span>
                      </label>
                    );
                  })}
                </div>
                <span className="hint">
                  {selectedStyleCards.length > 0
                    ? `已选 ${selectedStyleCards.length} 张，写正文时会融合模仿这些文风卡；也可到「拆书工坊」管理更多。`
                    : "选用后，写正文时会据此模仿目标笔触；可多选，多张将融合模仿。"}
                </span>
              </>
            )}
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
              填 0 = 依据目标字数自动规划；填入具体数值，则生成分卷时会让各卷章节数之和贴近该值；之后也可在第三步分卷里逐卷调整。
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
              依照维基百科「AI 写作特征」清单向模型注入分类反套路硬约束：禁对仗升华 / 否定排比 / 三段式堆砌，回避“缓缓 / 微微 / 嘴角勾起 / 五味杂陈 / 仿佛”等 AI 腔词，不在段末章末强行抒情，多用具体细节与有潜台词的对话。
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

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 8,
            }}
          >
            {!canStep2 && (
              <span className="hint" style={{ marginRight: "auto" }}>
                至少填写「题材类型」或「核心灵感」，才能进入下一步。
              </span>
            )}
            <button
              className="btn btn--primary"
              style={{ marginLeft: "auto" }}
              onClick={() => setSubStep(2)}
              disabled={!canStep2}
            >
              保存设定，下一步：故事设定集 →
            </button>
          </div>
        </section>
      )}

      {/* Step 2 — 故事设定集 */}
      {subStep === 2 && (
        <section className="fadeup" style={{ maxWidth: 860, margin: "0 auto" }}>
          {busy && stream && <StreamingPanel text={stream} />}

          {!bible && !busy && (
            <div
              className="panel"
              style={{ padding: "60px 30px", textAlign: "center" }}
            >
              <div className="seal" style={{ margin: "0 auto 18px" }}>
                典
              </div>
              <h3 style={{ fontSize: 19, marginBottom: 8 }}>
                第二步 · 生成故事设定集
              </h3>
              <p
                className="muted"
                style={{ maxWidth: 400, margin: "0 auto 20px" }}
              >
                依据你的创作设定，先定下故事内核、整体梗概、世界观、主题与主要人物。生成后可逐项修改，满意后再进入下一步规划分卷。
              </p>
              <button
                className="btn btn--primary"
                onClick={() => generateBible()}
                disabled={busy}
              >
                生成故事设定集
              </button>
            </div>
          )}

          {busy && !bible && (
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => abortRef.current?.abort()}
              >
                中止
              </button>
            </div>
          )}

          {bible && (
            <BibleView
              bible={bible}
              onChange={(b) => patch((p) => ({ ...p, bible: b }))}
            />
          )}

          {error && <ErrorNote>{error}</ErrorNote>}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 22,
            }}
          >
            <button className="btn btn--ghost" onClick={() => setSubStep(1)}>
              ← 返回修改设定
            </button>
            {bible && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => openRegen("bible")}
                disabled={busy}
              >
                {busy ? "重新生成中…" : "重新生成"}
              </button>
            )}
            <button
              className="btn btn--primary"
              style={{ marginLeft: "auto" }}
              onClick={() => setSubStep(3)}
              disabled={!canStep3}
            >
              下一步：规划分卷脉络 →
            </button>
          </div>
        </section>
      )}

      {/* Step 3 — 分卷脉络 */}
      {subStep === 3 && (
        <section className="fadeup" style={{ maxWidth: 980, margin: "0 auto" }}>
          {busy && stream && <StreamingPanel text={stream} />}

          {project.volumes.length === 0 && !busy && (
            <div
              className="panel"
              style={{ padding: "60px 30px", textAlign: "center" }}
            >
              <div className="seal" style={{ margin: "0 auto 18px" }}>
                纲
              </div>
              <h3 style={{ fontSize: 19, marginBottom: 8 }}>
                第三步 · 规划分卷脉络
              </h3>
              <p
                className="muted"
                style={{ maxWidth: 400, margin: "0 auto 20px" }}
              >
                依据上一步定稿的故事设定集，把全书拆成若干卷。生成后可逐卷编辑、增删，再展开到章节。
              </p>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <label className="faint" style={{ fontSize: 13 }}>
                  目标脉络段数（分卷数）
                </label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={1}
                  style={{ width: 96 }}
                  value={s.targetVolumes ?? 0}
                  onChange={(e) =>
                    setSetup({ targetVolumes: parseInt(e.target.value) || 0 })
                  }
                />
              </div>
              <p
                className="hint"
                style={{ maxWidth: 420, margin: "0 auto 20px" }}
              >
                填 0 = 依据目标字数 / 章节数自动推算分卷数；填入具体数值则严格按此卷数生成。
              </p>
              <button
                className="btn btn--primary"
                onClick={() => generateVolumes()}
                disabled={busy}
              >
                生成分卷脉络
              </button>
            </div>
          )}

          {busy && project.volumes.length === 0 && (
            <div style={{ textAlign: "center", marginTop: 14 }}>
              <button
                className="btn btn--ghost btn--sm"
                onClick={() => abortRef.current?.abort()}
              >
                中止
              </button>
            </div>
          )}

          {project.volumes.length > 0 && (
            <div>
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  marginBottom: 12,
                  gap: 12,
                }}
              >
                <h3 style={{ fontSize: 18 }}>分卷脉络</h3>
                <span
                  className="faint"
                  style={{ fontSize: 13, marginLeft: "auto" }}
                >
                  共 {project.volumes.length} 卷 · 计划{" "}
                  {project.volumes.reduce((a, v) => a + v.plannedChapters, 0)} 章
                </span>
                <label className="faint" style={{ fontSize: 12 }}>
                  段数
                </label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  step={1}
                  style={{ width: 64 }}
                  value={s.targetVolumes ?? 0}
                  onChange={(e) =>
                    setSetup({ targetVolumes: parseInt(e.target.value) || 0 })
                  }
                />
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={() => openRegen("volumes")}
                  disabled={busy}
                >
                  {busy ? "重新生成中…" : "重新生成分卷"}
                </button>
                <button className="btn btn--ghost btn--sm" onClick={addVolume}>
                  + 新增分卷
                </button>
              </div>

              <div style={{ display: "grid", gap: 12 }}>
                {project.volumes.map((v, vi) => (
                  <VolumeCard
                    key={v.id}
                    volume={v}
                    startNo={project.volumes
                      .slice(0, vi)
                      .reduce((a, x) => a + x.chapters.length, 0)}
                    expanding={expanding === v.id}
                    onExpand={() => expandVolume(v)}
                    onDelete={() => deleteVolume(v.id)}
                    onRegenChapter={(cid) => openRegenChapter(v.id, cid)}
                    onGenNext={() => genNextChapterOutline(v.id)}
                    busyChapterId={
                      outlineBusy && outlineBusy.volId === v.id
                        ? outlineBusy.chapterId
                        : null
                    }
                    nextBusy={Boolean(
                      outlineBusy &&
                        outlineBusy.volId === v.id &&
                        outlineBusy.chapterId === null
                    )}
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
            </div>
          )}

          {error && <ErrorNote>{error}</ErrorNote>}

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginTop: 22,
            }}
          >
            <button className="btn btn--ghost" onClick={() => setSubStep(2)}>
              ← 返回故事设定集
            </button>
            {anyChapters ? (
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                onClick={() => {
                  patch((p) => ({ ...p, phase: "writing" }));
                  goWriting();
                }}
              >
                进入正文创作 →
              </button>
            ) : (
              <span className="hint" style={{ marginLeft: "auto" }}>
                展开任意一卷的章节后，即可进入正文创作。
              </span>
            )}
          </div>
        </section>
      )}

      {regenAction && (
        <RegenDialog
          title={
            regenAction.kind === "bible"
              ? "重新生成故事设定集"
              : regenAction.kind === "volumes"
              ? "重新生成分卷脉络"
              : "重新生成本章脉络"
          }
          value={regenDir}
          onChange={setRegenDir}
          onCancel={() => setRegenAction(null)}
          onConfirm={confirmRegen}
        />
      )}
    </main>
  );
}



"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ArchiveResult from "@/components/ArchiveResult";
import CardLibrary from "@/components/CardLibrary";
import {
  createProject,
  fetchProject,
  fetchProjects,
  fetchStyleCards,
  fetchArchives,
  deleteStyleCardRemote,
  deleteArchiveRemote,
  loadConfig,
  saveProjectRemote,
} from "@/lib/client";
import type { ProjectSummary, StoryArchive, StyleCard } from "@/lib/types";
import {
  MIN_TEXT_LEN,
  blankStyleCard,
  chunkText,
  coverChunks,
  hashText,
  mergeStyleChunks,
  normalizeChunk,
  sampleChunks,
} from "@/lib/style";
import { readTextFile } from "@/lib/encoding";
import {
  applyArchiveReduce,
  buildReduceMaterial,
  mergeArchiveChunks,
  normalizeArchiveChunk,
  seedProjectFromArchive,
} from "@/lib/archive";

type Tab = "style" | "archive";
type Status = "idle" | "cached" | "analyzing" | "done";

// 上传体积上限：纯为防误传巨文件，非分析能力限制。汉语 UTF-8 约 3 字节/字，
// 50MB 约对应 1600 万字，足够覆盖超长篇网文；学文风采样、拆设定分组均已按块封顶。
const MAX_FILE_MB = 50;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;

export default function StylePage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("style");

  // shared upload
  const [fileName, setFileName] = useState("");
  const [text, setText] = useState("");
  const [encoding, setEncoding] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // style mode
  const [styleStatus, setStyleStatus] = useState<Status>("idle");
  const [styleProgress, setStyleProgress] = useState({ done: 0, total: 0 });
  const [card, setCard] = useState<StyleCard | null>(null);
  const [styleCards, setStyleCards] = useState<StyleCard[]>([]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<StyleCard | null>(null);
  const [savingCard, setSavingCard] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [targetId, setTargetId] = useState("");
  const [applyMsg, setApplyMsg] = useState<string | null>(null);

  // archive mode
  const [archiveStatus, setArchiveStatus] = useState<Status>("idle");
  const [archiveProgress, setArchiveProgress] = useState({ done: 0, total: 0 });
  const [archive, setArchive] = useState<StoryArchive | null>(null);
  const [archiveCards, setArchiveCards] = useState<StoryArchive[]>([]);
  const [creating, setCreating] = useState(false);
  const [createMsg, setCreateMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchProjects().then((ps) => {
      setProjects(ps);
      if (ps[0]) setTargetId(ps[0].id);
    });
    fetchStyleCards().then(setStyleCards);
    fetchArchives().then(setArchiveCards);
  }, []);

  const busy =
    styleStatus === "analyzing" || archiveStatus === "analyzing" || creating;
  const charCount = useMemo(() => text.replace(/\s+/g, "").length, [text]);

  function resetResults() {
    setError(null);
    setStyleStatus("idle");
    setStyleProgress({ done: 0, total: 0 });
    setCard(null);
    setEditing(false);
    setDraft(null);
    setApplyMsg(null);
    setArchiveStatus("idle");
    setArchiveProgress({ done: 0, total: 0 });
    setArchive(null);
    setCreateMsg(null);
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    resetResults();
    if (!/\.txt$/i.test(f.name)) {
      setError("仅支持 .txt 格式（.epub 请先转为纯文本）。");
      return;
    }
    if (f.size > MAX_FILE_BYTES) {
      setError(`文件大小不能超过 ${MAX_FILE_MB}MB。`);
      return;
    }
    // Decode with encoding detection — Chinese novels are frequently GBK /
    // GB18030 / UTF-16, and decoding those as UTF-8 yields mojibake that makes
    // the model hallucinate. See lib/encoding.ts.
    const { text: content, encoding: enc, garbledRatio } = await readTextFile(f);
    if (garbledRatio > 0.02) {
      setError(
        `文件解码后仍有大量乱码（疑似非常见编码，已尝试 UTF-8/GB18030）。请先用记事本等工具将其另存为 UTF-8 编码后重试。`
      );
      setFileName(f.name);
      setText("");
      setEncoding(enc);
      return;
    }
    if (content.replace(/\s+/g, "").length < MIN_TEXT_LEN) {
      setError("文本内容过短，无法进行有效分析（需至少约 1000 字）。");
      setFileName(f.name);
      setText("");
      setEncoding(enc);
      return;
    }
    setFileName(f.name);
    setText(content);
    setEncoding(enc);
  }

  function preflight(): ReturnType<typeof loadConfig> | null {
    if (!text) return null;
    const cfg = loadConfig();
    if (!cfg.apiKey) {
      setError("尚未配置模型接口，请先到「接口设置」填写。");
      return null;
    }
    setError(null);
    return cfg;
  }

  async function runStyle() {
    const cfg = preflight();
    if (!cfg) return;
    setApplyMsg(null);
    setCard(null);

    const hash = hashText(text);
    try {
      const res = await fetch(`/api/styles/${hash}`, { cache: "no-store" });
      if (res.ok) {
        setCard((await res.json()) as StyleCard);
        setStyleStatus("cached");
        return;
      }
    } catch {
      // ignore cache errors; fall through to fresh analysis
    }

    const sampled = sampleChunks(chunkText(text));
    setStyleProgress({ done: 0, total: sampled.length });
    setStyleStatus("analyzing");

    const parts = [];
    try {
      for (let i = 0; i < sampled.length; i++) {
        const res = await fetch("/api/style-analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: cfg, text: sampled[i] }),
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          throw new Error(msg || `分析失败 (${res.status})`);
        }
        parts.push(normalizeChunk(await res.json()));
        setStyleProgress({ done: i + 1, total: sampled.length });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析服务暂时不可用");
      setStyleStatus("idle");
      return;
    }

    const merged = mergeStyleChunks(parts, {
      sourceFileHash: hash,
      sourceFileName: fileName,
    });
    setCard(merged);
    setStyleStatus("done");
    fetch(`/api/styles/${hash}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(merged),
    })
      .then(() => fetchStyleCards().then(setStyleCards))
      .catch(() => {});
  }

  async function runArchive() {
    const cfg = preflight();
    if (!cfg) return;
    setCreateMsg(null);
    setArchive(null);

    const hash = hashText(text);
    try {
      const res = await fetch(`/api/archives/${hash}`, { cache: "no-store" });
      if (res.ok) {
        setArchive((await res.json()) as StoryArchive);
        setArchiveStatus("cached");
        return;
      }
    } catch {
      // ignore cache errors; fall through to fresh analysis
    }

    const sampled = coverChunks(chunkText(text));
    // total = 逐段分析 + 最后一步全书综合(reduce)
    setArchiveProgress({ done: 0, total: sampled.length + 1 });
    setArchiveStatus("analyzing");

    const parts = [];
    try {
      for (let i = 0; i < sampled.length; i++) {
        const res = await fetch("/api/archive-analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ config: cfg, text: sampled[i] }),
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          throw new Error(msg || `分析失败 (${res.status})`);
        }
        parts.push(normalizeArchiveChunk(await res.json()));
        setArchiveProgress({ done: i + 1, total: sampled.length + 1 });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "分析服务暂时不可用");
      setArchiveStatus("idle");
      return;
    }

    let merged = mergeArchiveChunks(parts, {
      sourceFileHash: hash,
      sourceFileName: fileName,
    });

    // Reduce: 综合全书视角，修正整体概述/世界观/主题，并精炼主线为少量阶段节点。
    // 失败不致命——保留确定性合并结果即可。
    try {
      const res = await fetch("/api/archive-reduce", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: cfg, material: buildReduceMaterial(parts) }),
      });
      if (res.ok) merged = applyArchiveReduce(merged, await res.json());
    } catch {
      // keep deterministic merge on reduce failure
    }
    setArchiveProgress({ done: sampled.length + 1, total: sampled.length + 1 });

    setArchive(merged);
    setArchiveStatus("done");
    fetch(`/api/archives/${hash}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(merged),
    })
      .then(() => fetchArchives().then(setArchiveCards))
      .catch(() => {});
  }

  // ---- saved-card library (调用 / 删除) ----
  function loadStyleCard(hash: string) {
    const found = styleCards.find((c) => c.sourceFileHash === hash);
    if (!found) return;
    setError(null);
    setApplyMsg(null);
    setEditing(false);
    setDraft(null);
    setCard(found);
    setStyleStatus("cached");
  }

  async function removeStyleCard(hash: string) {
    await deleteStyleCardRemote(hash);
    setStyleCards((cs) => cs.filter((c) => c.sourceFileHash !== hash));
    if (card?.sourceFileHash === hash) {
      setCard(null);
      setStyleStatus("idle");
    }
  }

  function loadArchiveCard(hash: string) {
    const found = archiveCards.find((a) => a.sourceFileHash === hash);
    if (!found) return;
    setError(null);
    setCreateMsg(null);
    setArchive(found);
    setArchiveStatus("cached");
  }

  async function removeArchiveCard(hash: string) {
    await deleteArchiveRemote(hash);
    setArchiveCards((as) => as.filter((a) => a.sourceFileHash !== hash));
    if (archive?.sourceFileHash === hash) {
      setArchive(null);
      setArchiveStatus("idle");
    }
  }

  function exportStyle() {
    if (!card) return;
    downloadJson(card, `文风规则卡-${card.styleName || "style"}.json`);
  }

  // ---- edit an existing style card in place ----
  function startEditCard() {
    if (!card) return;
    const base = structuredClone(card);
    // Older cached cards predate the `signature` field — backfill so the
    // controlled textarea and save path never see undefined.
    if (typeof base.signature !== "string") base.signature = "";
    setDraft(base);
    setEditing(true);
    setApplyMsg(null);
  }
  // 自定义文风：新建一张空白卡并直接进入编辑，按框架手动填写；
  // 保存走与编辑卡相同的 saveEditCard（PUT 到 /api/styles/<custom-hash>）。
  function createCustomCard() {
    const base = blankStyleCard();
    setError(null);
    setApplyMsg(null);
    setCard(base);
    setDraft(structuredClone(base));
    setEditing(true);
    setStyleStatus("done");
  }
  function cancelEditCard() {
    setEditing(false);
    setDraft(null);
  }
  function patchDraft(mut: (d: StyleCard) => void) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = structuredClone(prev);
      mut(next);
      return next;
    });
  }
  async function saveEditCard() {
    if (!draft) return;
    const cleaned = normalizeEditedCard(draft);
    setSavingCard(true);
    try {
      const res = await fetch(`/api/styles/${cleaned.sourceFileHash}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(cleaned),
      });
      if (!res.ok) throw new Error();
      setCard(cleaned);
      setStyleCards((cs) =>
        cs.some((c) => c.sourceFileHash === cleaned.sourceFileHash)
          ? cs.map((c) => (c.sourceFileHash === cleaned.sourceFileHash ? cleaned : c))
          : [cleaned, ...cs]
      );
      setEditing(false);
      setDraft(null);
      setApplyMsg("已保存修改。");
    } catch {
      setApplyMsg("保存失败，请重试。");
    } finally {
      setSavingCard(false);
    }
  }
  function exportArchive() {
    if (!archive) return;
    downloadJson(archive, `作品档案-${archive.title || "archive"}.json`);
  }

  async function applyToProject() {
    if (!card || !targetId) return;
    setApplyMsg(null);
    const proj = await fetchProject(targetId);
    if (!proj) {
      setApplyMsg("目标作品不存在。");
      return;
    }
    // 多卡支持：追加到作品的 styleCards（按源文件哈希去重；已存在则更新），
    // 并清空旧版单张 styleCard 避免重复计入。
    const existing =
      proj.setup.styleCards && proj.setup.styleCards.length
        ? proj.setup.styleCards
        : proj.setup.styleCard
        ? [proj.setup.styleCard]
        : [];
    const next = existing.some((c) => c.sourceFileHash === card.sourceFileHash)
      ? existing.map((c) =>
          c.sourceFileHash === card.sourceFileHash ? card : c
        )
      : [...existing, card];
    proj.setup = { ...proj.setup, styleCards: next, styleCard: null };
    await saveProjectRemote(proj);
    const name = projects.find((p) => p.id === targetId)?.title || "作品";
    setApplyMsg(`已应用到《${name}》，共 ${next.length} 张文风卡将在生成正文时融合模仿。`);
  }

  async function createFromArchive() {
    if (!archive) return;
    setCreating(true);
    setCreateMsg(null);
    try {
      const proj = await createProject(`${archive.title}·二创`);
      const seeded = seedProjectFromArchive(proj, archive);
      await saveProjectRemote(seeded);
      setCreateMsg("已创建新作品，正在跳转…");
      router.push(`/project/${seeded.id}`);
    } catch (e) {
      setCreateMsg(e instanceof Error ? e.message : "创建失败");
      setCreating(false);
    }
  }

  const styleBusy = styleStatus === "analyzing";
  const archiveBusy = archiveStatus === "analyzing";
  const progress = tab === "style" ? styleProgress : archiveProgress;
  const cached = tab === "style" ? styleStatus === "cached" : archiveStatus === "cached";

  return (
    <>
      <main className="shell" style={{ paddingTop: 28, paddingBottom: 60 }}>
        <h1 style={{ fontSize: 26 }}>拆书工坊</h1>
        <p className="muted" style={{ marginTop: 6, marginBottom: 18 }}>
          {tab === "style"
            ? "上传一本 .txt 书籍，从 7 个维度分析写作风格，生成可复用的「文风规则卡」，一键应用到你的作品。"
            : "上传一本 .txt 书籍，抽取世界观、人物、主线剧情等，生成「作品档案」，可一键二创开新书。"}
        </p>

        {/* Tabs */}
        <div className="panel-tabs" style={{ marginBottom: 18 }}>
          <button
            className={tab === "style" ? "ptab ptab--on" : "ptab"}
            onClick={() => setTab("style")}
          >
            学文风
          </button>
          <button
            className={tab === "archive" ? "ptab ptab--on" : "ptab"}
            onClick={() => setTab("archive")}
          >
            拆设定
          </button>
        </div>

        {/* Upload + action (shared) */}
        <section className="panel" style={{ padding: 18, marginBottom: 18 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
            <input
              ref={inputRef}
              type="file"
              accept=".txt,text/plain"
              onChange={onFile}
              style={{ display: "none" }}
            />
            <button
              className="btn btn--ghost btn--sm"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              选择 .txt 文件
            </button>
            <span className="faint" style={{ fontSize: 13, flex: 1, minWidth: 0 }}>
              {fileName
                ? `${fileName}${charCount ? ` · 约 ${(charCount / 10000).toFixed(1)} 万字` : ""}${encoding ? ` · ${encoding}` : ""}`
                : `未选择文件（≤${MAX_FILE_MB}MB）`}
            </span>
            <button
              className="btn btn--primary btn--sm"
              onClick={tab === "style" ? runStyle : runArchive}
              disabled={busy || !text}
            >
              {(tab === "style" ? styleBusy : archiveBusy)
                ? "分析中…"
                : tab === "style"
                ? "分析文风"
                : "抽取设定"}
            </button>
            {tab === "style" && (
              <button
                className="btn btn--ghost btn--sm"
                onClick={createCustomCard}
                disabled={busy}
                title="不上传范文，直接按七维框架手动新建一张文风卡"
              >
                ＋ 自定义文风卡
              </button>
            )}
          </div>

          {(styleBusy || archiveBusy) && (
            <p className="chip chip--cinnabar" style={{ display: "inline-block", marginTop: 12 }}>
              {archiveBusy && progress.total > 1 && progress.done >= progress.total - 1
                ? "正在综合全书设定…"
                : `正在分析第 ${progress.done + 1}/${progress.total} 块…`}
            </p>
          )}
          {cached && (
            <p className="faint" style={{ marginTop: 12, fontSize: 13 }}>
              命中缓存：该文件此前已分析过，直接返回结果（未消耗模型调用）。
            </p>
          )}
          {error && (
            <p
              className="chip chip--cinnabar"
              style={{ display: "block", padding: "10px 12px", marginTop: 12 }}
            >
              {error}
            </p>
          )}
        </section>

        {/* Saved-card library */}
        {tab === "style" ? (
          <CardLibrary
            title="已保存文风卡"
            items={styleCards.map((c) => ({
              hash: c.sourceFileHash,
              name: c.styleName,
              sourceFileName: c.sourceFileName,
              createdAt: c.createdAt,
            }))}
            activeHash={card?.sourceFileHash}
            busy={busy}
            onLoad={loadStyleCard}
            onDelete={removeStyleCard}
          />
        ) : (
          <CardLibrary
            title="已保存设定卡"
            items={archiveCards.map((a) => ({
              hash: a.sourceFileHash,
              name: a.title,
              sourceFileName: a.sourceFileName,
              createdAt: a.createdAt,
            }))}
            activeHash={archive?.sourceFileHash}
            busy={busy}
            onLoad={loadArchiveCard}
            onDelete={removeArchiveCard}
          />
        )}

        {/* Results */}
        {tab === "style" && card && (
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
                文风规则卡 · <span style={{ color: "var(--cinnabar)" }}>{card.styleName}</span>
              </h2>
              {editing ? (
                <>
                  <button
                    className="btn btn--primary btn--sm"
                    onClick={saveEditCard}
                    disabled={savingCard}
                  >
                    {savingCard ? "保存中…" : "保存修改"}
                  </button>
                  <button
                    className="btn btn--ghost btn--sm"
                    onClick={cancelEditCard}
                    disabled={savingCard}
                  >
                    取消
                  </button>
                </>
              ) : (
                <>
                  <button className="btn btn--ghost btn--sm" onClick={startEditCard}>
                    编辑
                  </button>
                  <button className="btn btn--ghost btn--sm" onClick={exportStyle}>
                    导出 .json
                  </button>
                </>
              )}
            </div>

            {!editing && card.signature && (
              <p
                className="panel"
                style={{
                  padding: "12px 16px",
                  marginBottom: 14,
                  fontSize: 13,
                  lineHeight: 1.6,
                  color: "var(--fg-dim)",
                  borderLeft: "3px solid var(--cinnabar)",
                }}
              >
                <span style={{ fontFamily: "var(--font-serif)", color: "var(--fg)" }}>
                  模仿指南　
                </span>
                {card.signature}
              </p>
            )}

            {editing && draft ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                  gap: 14,
                }}
              >
                <DimCard title="基本">
                  <EInput
                    label="风格名称"
                    value={draft.styleName}
                    onChange={(v) => patchDraft((d) => { d.styleName = v; })}
                  />
                  <EArea
                    label="模仿指南"
                    rows={3}
                    value={draft.signature}
                    onChange={(v) => patchDraft((d) => { d.signature = v; })}
                  />
                </DimCard>

                <DimCard title="句式节奏">
                  <EInput
                    label="平均句长"
                    value={draft.sentenceRhythm.avgLength}
                    onChange={(v) => patchDraft((d) => { d.sentenceRhythm.avgLength = v; })}
                  />
                  <EArea
                    label="节奏特征"
                    value={draft.sentenceRhythm.pattern}
                    onChange={(v) => patchDraft((d) => { d.sentenceRhythm.pattern = v; })}
                  />
                  <EList
                    label="例句"
                    items={draft.sentenceRhythm.examples}
                    onChange={(v) => patchDraft((d) => { d.sentenceRhythm.examples = v; })}
                  />
                </DimCard>

                <DimCard title="词汇特征">
                  <EInput
                    label="语体色彩"
                    value={draft.vocabulary.register}
                    onChange={(v) => patchDraft((d) => { d.vocabulary.register = v; })}
                  />
                  <EList
                    label="高频词"
                    hint="（不含人名）"
                    items={draft.vocabulary.highFreqWords}
                    onChange={(v) => patchDraft((d) => { d.vocabulary.highFreqWords = v; })}
                  />
                  <EList
                    label="禁用词"
                    items={draft.vocabulary.forbiddenWords}
                    onChange={(v) => patchDraft((d) => { d.vocabulary.forbiddenWords = v; })}
                  />
                </DimCard>

                <DimCard title="描写策略">
                  <EInput
                    label="动作:心理"
                    value={draft.descriptionStrategy.actionVsPsychology}
                    onChange={(v) => patchDraft((d) => { d.descriptionStrategy.actionVsPsychology = v; })}
                  />
                  <EArea
                    label="感官偏好"
                    value={draft.descriptionStrategy.sensoryPreference}
                    onChange={(v) => patchDraft((d) => { d.descriptionStrategy.sensoryPreference = v; })}
                  />
                </DimCard>

                <DimCard title="对话风格">
                  <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
                    <span className="faint">口语化 (0-10)</span>
                    <input
                      className="input"
                      type="number"
                      min={0}
                      max={10}
                      value={draft.dialogueStyle.colloquialScore}
                      onChange={(e) =>
                        patchDraft((d) => {
                          d.dialogueStyle.colloquialScore = Number(e.target.value) || 0;
                        })
                      }
                    />
                  </label>
                  <EInput
                    label="潜台词密度"
                    value={draft.dialogueStyle.subtextDensity}
                    onChange={(v) => patchDraft((d) => { d.dialogueStyle.subtextDensity = v; })}
                  />
                  <EArea
                    label="对话标签"
                    value={draft.dialogueStyle.tagHabit}
                    onChange={(v) => patchDraft((d) => { d.dialogueStyle.tagHabit = v; })}
                  />
                </DimCard>

                <DimCard title="叙事结构">
                  <EInput
                    label="叙事视角"
                    value={draft.narrativeStructure.perspective}
                    onChange={(v) => patchDraft((d) => { d.narrativeStructure.perspective = v; })}
                  />
                  <EInput
                    label="时间线"
                    value={draft.narrativeStructure.timeline}
                    onChange={(v) => patchDraft((d) => { d.narrativeStructure.timeline = v; })}
                  />
                </DimCard>

                <DimCard title="情绪基调">
                  <EInput
                    label="基调"
                    value={draft.emotionalTone.tone}
                    onChange={(v) => patchDraft((d) => { d.emotionalTone.tone = v; })}
                  />
                  <EInput
                    label="表达方式"
                    value={draft.emotionalTone.expressionMode}
                    onChange={(v) => patchDraft((d) => { d.emotionalTone.expressionMode = v; })}
                  />
                </DimCard>

                <DimCard title="修辞偏好">
                  <EList
                    label="偏好"
                    items={draft.rhetoric.preferredTypes}
                    onChange={(v) => patchDraft((d) => { d.rhetoric.preferredTypes = v; })}
                  />
                  <EInput
                    label="使用频率"
                    value={draft.rhetoric.frequency}
                    onChange={(v) => patchDraft((d) => { d.rhetoric.frequency = v; })}
                  />
                  <EList
                    label="例句"
                    items={draft.rhetoric.examples}
                    onChange={(v) => patchDraft((d) => { d.rhetoric.examples = v; })}
                  />
                </DimCard>
              </div>
            ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
                gap: 14,
              }}
            >
              <DimCard title="句式节奏">
                <Row k="平均句长" v={card.sentenceRhythm.avgLength} />
                <Row k="节奏特征" v={card.sentenceRhythm.pattern} />
                <Examples items={card.sentenceRhythm.examples} />
              </DimCard>

              <DimCard title="词汇特征">
                <Row k="语体色彩" v={card.vocabulary.register} />
                <Tags label="高频词" items={card.vocabulary.highFreqWords} />
                <Tags label="禁用词" items={card.vocabulary.forbiddenWords} danger />
              </DimCard>

              <DimCard title="描写策略">
                <Row k="动作:心理" v={card.descriptionStrategy.actionVsPsychology} />
                <Row k="感官偏好" v={card.descriptionStrategy.sensoryPreference} />
              </DimCard>

              <DimCard title="对话风格">
                <Row k="口语化" v={`${card.dialogueStyle.colloquialScore} / 10`} />
                <Row k="潜台词密度" v={card.dialogueStyle.subtextDensity} />
                <Row k="对话标签" v={card.dialogueStyle.tagHabit} />
              </DimCard>

              <DimCard title="叙事结构">
                <Row k="叙事视角" v={card.narrativeStructure.perspective} />
                <Row k="时间线" v={card.narrativeStructure.timeline} />
              </DimCard>

              <DimCard title="情绪基调">
                <Row k="基调" v={card.emotionalTone.tone} />
                <Row k="表达方式" v={card.emotionalTone.expressionMode} />
              </DimCard>

              <DimCard title="修辞偏好">
                <Tags label="偏好" items={card.rhetoric.preferredTypes} />
                <Row k="使用频率" v={card.rhetoric.frequency} />
                <Examples items={card.rhetoric.examples} />
              </DimCard>
            </div>
            )}

            {/* Apply to a project */}
            {!editing && (
            <section className="panel" style={{ padding: 18, marginTop: 18 }}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
                <span style={{ fontFamily: "var(--font-serif)" }}>应用到作品：</span>
                {projects.length === 0 ? (
                  <span className="faint" style={{ fontSize: 13 }}>
                    暂无作品，请先在书房新建。
                  </span>
                ) : (
                  <>
                    <select
                      className="input"
                      value={targetId}
                      onChange={(e) => setTargetId(e.target.value)}
                      style={{ maxWidth: 260 }}
                    >
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                    <button className="btn btn--primary btn--sm" onClick={applyToProject}>
                      应用文风
                    </button>
                  </>
                )}
                {applyMsg && (
                  <span className="faint" style={{ fontSize: 13 }}>
                    {applyMsg}
                  </span>
                )}
              </div>
            </section>
            )}
          </>
        )}

        {tab === "archive" && archive && (
          <ArchiveResult
            archive={archive}
            creating={creating}
            createMsg={createMsg}
            onCreate={createFromArchive}
            onExport={exportArchive}
          />
        )}
      </main>
    </>
  );
}

/** Trim + drop empty entries in every list field before persisting an edit. */
function normalizeEditedCard(c: StyleCard): StyleCard {
  const clean = (a: string[]) => a.map((s) => s.trim()).filter(Boolean);
  return {
    ...c,
    styleName: c.styleName.trim() || "未命名文风",
    signature: (c.signature || "").trim(),
    sentenceRhythm: {
      ...c.sentenceRhythm,
      examples: clean(c.sentenceRhythm.examples),
    },
    vocabulary: {
      ...c.vocabulary,
      highFreqWords: clean(c.vocabulary.highFreqWords),
      forbiddenWords: clean(c.vocabulary.forbiddenWords),
    },
    rhetoric: {
      ...c.rhetoric,
      preferredTypes: clean(c.rhetoric.preferredTypes),
      examples: clean(c.rhetoric.examples),
    },
  };
}

function EInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span className="faint">{label}</span>
      <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function EArea({
  label,
  value,
  onChange,
  rows = 2,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows?: number;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span className="faint">{label}</span>
      <textarea
        className="input"
        rows={rows}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
      />
    </label>
  );
}

// List editor: one item per line. We DON'T trim/filter on each keystroke (that
// would fight the cursor when typing a new line); cleanup happens on save.
function EList({
  label,
  items,
  onChange,
  hint,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
  hint?: string;
}) {
  return (
    <label style={{ display: "grid", gap: 4, fontSize: 13 }}>
      <span className="faint">
        {label}
        {hint ? <span style={{ marginLeft: 6, opacity: 0.7 }}>{hint}</span> : null}
      </span>
      <textarea
        className="input"
        rows={3}
        value={items.join("\n")}
        placeholder="每行一项"
        onChange={(e) => onChange(e.target.value.split("\n"))}
        style={{ resize: "vertical", fontFamily: "inherit", lineHeight: 1.5 }}
      />
    </label>
  );
}

function downloadJson(data: unknown, filename: string) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function DimCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel" style={{ padding: 16 }}>
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

function Tags({
  label,
  items,
  danger,
}: {
  label: string;
  items: string[];
  danger?: boolean;
}) {
  if (!items.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, fontSize: 13, flexWrap: "wrap", alignItems: "baseline" }}>
      <span className="faint" style={{ minWidth: 62 }}>
        {label}
      </span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {items.map((w, i) => (
          <span
            key={i}
            className={danger ? "chip chip--cinnabar" : "chip"}
            style={{ fontSize: 12 }}
          >
            {w}
          </span>
        ))}
      </span>
    </div>
  );
}

function Examples({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ display: "grid", gap: 4, marginTop: 2 }}>
      {items.map((ex, i) => (
        <div
          key={i}
          className="faint"
          style={{
            fontSize: 12,
            lineHeight: 1.5,
            paddingLeft: 10,
            borderLeft: "2px solid var(--line-strong)",
          }}
        >
          {ex}
        </div>
      ))}
    </div>
  );
}

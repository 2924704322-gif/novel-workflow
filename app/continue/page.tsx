"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  createProject,
  fetchArchives,
  fetchStyleCards,
  formatWords,
  hasConfig,
  saveProjectRemote,
} from "@/lib/client";
import { readTextFile } from "@/lib/encoding";
import { parseNovel, type ParsedBook } from "@/lib/parseNovel";
import { archiveToContinuation } from "@/lib/archive";
import type {
  Project,
  StoryArchive,
  StoryBible,
  StyleCard,
} from "@/lib/types";

const MAX_FILE_MB = 50;
const MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024;
const MIN_LEN = 500; // 少于此字数不值得续写

// Compose the imported book + chosen style/archive into a ready-to-write
// Project. The parsed chapters are kept as-is (already "done"); the archive (if
// any) supplies the story bible + codex, the style card is applied for later
// prose generation. Phase jumps straight to "writing" so the workspace opens on
// the manuscript for reading + continuing.
function buildContinuationProject(
  base: Project,
  parsed: ParsedBook,
  archive: StoryArchive | null,
  styleCard: StyleCard | null,
  title: string
): Project {
  const seeded = archive ? archiveToContinuation(archive) : null;
  const bible: StoryBible = seeded
    ? seeded.bible
    : {
        logline: "",
        synopsis: "",
        worldbuilding: "",
        themes: "",
        tone: styleCard?.styleName || base.setup.style || "",
        characters: [],
      };
  const note = archive
    ? `本作是对《${archive.title}》的续写：请严格延续既有世界观、力量体系、人物与已发生的剧情，自然衔接现有最新章节继续往后写，不要重启、改写或复述已有情节。`
    : "本作是对已导入原文的续写：请延续既有人物、设定与已发生的剧情，衔接现有最新章节继续往后写，不要重启、改写或复述已有情节。";
  return {
    ...base,
    title: title.trim() || base.title,
    phase: "writing",
    setup: {
      ...base.setup,
      styleCard: styleCard ?? null,
      style: archive?.styleHint || styleCard?.styleName || base.setup.style,
      premise: archive
        ? `续写来源：《${archive.title}》。${archive.synopsis.slice(0, 120)}`
        : base.setup.premise,
      extra: note,
    },
    bible,
    volumes: parsed.volumes,
    codex: seeded ? seeded.codex : [],
    foreshadows: [],
  };
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}

export default function ContinuePage() {
  const router = useRouter();

  const [fileName, setFileName] = useState("");
  const [encoding, setEncoding] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [parsed, setParsed] = useState<ParsedBook | null>(null);
  const [title, setTitle] = useState("");
  const [parsing, setParsing] = useState(false);

  const [styleCards, setStyleCards] = useState<StyleCard[]>([]);
  const [archives, setArchives] = useState<StoryArchive[]>([]);
  const [styleId, setStyleId] = useState("");
  const [archiveId, setArchiveId] = useState("");

  const [previewId, setPreviewId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [configReady, setConfigReady] = useState(true);

  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setConfigReady(hasConfig());
    fetchStyleCards().then(setStyleCards);
    fetchArchives().then(setArchives);
  }, []);

  const totalWords = useMemo(() => {
    if (!parsed) return 0;
    return parsed.volumes.reduce(
      (n, v) => n + v.chapters.reduce((m, c) => m + c.wordCount, 0),
      0
    );
  }, [parsed]);

  const previewChapter = useMemo(() => {
    if (!parsed || !previewId) return null;
    for (const v of parsed.volumes) {
      for (const c of v.chapters) if (c.id === previewId) return { v, c };
    }
    return null;
  }, [parsed, previewId]);

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!f) return;
    setError(null);
    setParsed(null);
    setPreviewId(null);
    if (f.size > MAX_FILE_BYTES) {
      setError(`文件大小不能超过 ${MAX_FILE_MB}MB。`);
      return;
    }
    setParsing(true);
    setFileName(f.name);
    try {
      // Chinese novels are frequently GBK / GB18030 / UTF-16 — decode with
      // detection, otherwise mojibake ruins both reading and generation.
      const { text, encoding: enc, garbledRatio } = await readTextFile(f);
      setEncoding(enc);
      if (garbledRatio > 0.02) {
        setError(
          "文件解码后仍有大量乱码（疑似非常见编码）。请先用记事本等工具另存为 UTF-8 编码后重试。"
        );
        return;
      }
      if (text.replace(/\s+/g, "").length < MIN_LEN) {
        setError("文本内容过短，无法作为续写底本（至少约 500 字）。");
        return;
      }
      const book = parseNovel(text);
      if (book.chapterCount === 0) {
        setError("未能从文本中解析出任何章节。");
        return;
      }
      setParsed(book);
      setTitle(stripExt(f.name) || "续写作品");
      setPreviewId(book.volumes[0]?.chapters[0]?.id ?? null);
    } catch {
      setError("读取文件失败，请重试。");
    } finally {
      setParsing(false);
    }
  }

  async function startContinue() {
    if (!parsed) return;
    setCreating(true);
    setError(null);
    try {
      const base = await createProject(title.trim() || "续写作品");
      const archive =
        archives.find((a) => a.sourceFileHash === archiveId) || null;
      const styleCard =
        styleCards.find((s) => s.sourceFileHash === styleId) || null;
      const proj = buildContinuationProject(
        base,
        parsed,
        archive,
        styleCard,
        title
      );
      await saveProjectRemote(proj);
      router.push(`/project/${proj.id}`);
    } catch {
      setError("创建续写作品失败，请重试。");
      setCreating(false);
    }
  }

  return (
    <>
      <main className="shell" style={{ paddingTop: 44, paddingBottom: 90 }}>
        <div className="fadeup" style={{ maxWidth: 760, marginBottom: 22 }}>
          <div className="chip chip--cinnabar" style={{ marginBottom: 14 }}>
            接着别人的书 · 或自己的旧稿 · 往下写
          </div>
          <h1 style={{ fontSize: 34, marginBottom: 10 }}>续写一本书</h1>
          <p className="muted" style={{ fontSize: 15 }}>
            导入一份 .txt，自动按原文分卷分章；可选套用拆书工坊的文风卡与设定卡。
            续写新章时会自动提炼前几章的大致内容，让剧情接得上、不跑偏。
          </p>
        </div>

        {!configReady && (
          <div
            className="panel"
            style={{
              padding: "14px 18px",
              display: "flex",
              alignItems: "center",
              gap: 14,
              marginBottom: 18,
              borderColor: "rgba(197,106,63,.4)",
            }}
          >
            <span className="dot dot--draft" />
            <span className="muted" style={{ flex: 1 }}>
              还没接上模型接口，导入与阅读可用，但续写生成会用不了。
            </span>
            <Link href="/settings" className="btn btn--ghost btn--sm">
              去设置
            </Link>
          </div>
        )}

        {/* Upload */}
        <section className="panel" style={{ padding: 18, marginBottom: 18 }}>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              alignItems: "center",
            }}
          >
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
              disabled={parsing}
            >
              {parsing ? "解析中…" : "选择 .txt 底本"}
            </button>
            <span
              className="faint"
              style={{ fontSize: 13, flex: 1, minWidth: 0 }}
            >
              {fileName
                ? `${fileName}${encoding ? ` · ${encoding}` : ""}`
                : `未选择文件（≤${MAX_FILE_MB}MB，支持 UTF-8 / GBK / GB18030）`}
            </span>
          </div>
          {error && (
            <p
              className="chip chip--cinnabar"
              style={{
                display: "block",
                padding: "10px 12px",
                marginTop: 12,
                lineHeight: 1.5,
              }}
            >
              {error}
            </p>
          )}
        </section>

        {parsed && (
          <>
            {/* Parse summary + title */}
            <section className="panel" style={{ padding: 18, marginBottom: 18 }}>
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  flexWrap: "wrap",
                  alignItems: "center",
                  marginBottom: 14,
                }}
              >
                <span className="chip">{parsed.volumeCount} 卷</span>
                <span className="chip">{parsed.chapterCount} 章</span>
                <span className="chip">{formatWords(totalWords)}</span>
                {!parsed.detected && (
                  <span
                    className="chip chip--cinnabar"
                    title="未识别到「第 X 章」这类标题，已按段落自动切分为章节。你仍可正常阅读与续写。"
                  >
                    未识别章节标题 · 已自动切分
                  </span>
                )}
              </div>
              <div className="field">
                <label className="label" htmlFor="title">
                  作品名
                </label>
                <input
                  id="title"
                  className="input"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  maxLength={40}
                  placeholder="给这本续写作品起个名"
                />
              </div>
            </section>

            {/* Optional style / archive */}
            <section className="panel" style={{ padding: 18, marginBottom: 18 }}>
              <h3 style={{ fontSize: 16, marginBottom: 4 }}>套用拆书成果（可选）</h3>
              <p className="faint" style={{ fontSize: 12.5, marginBottom: 14 }}>
                文风卡让续写模仿原著笔触；设定卡把世界观、人物、力量体系填入设定库，续写更贴合原作。
              </p>
              <div
                style={{
                  display: "grid",
                  gap: 14,
                  gridTemplateColumns: "1fr 1fr",
                }}
              >
                <div className="field" style={{ margin: 0 }}>
                  <label className="label">文风卡（拆文风）</label>
                  <select
                    className="input"
                    value={styleId}
                    onChange={(e) => setStyleId(e.target.value)}
                  >
                    <option value="">不套用文风卡</option>
                    {styleCards.map((s) => (
                      <option key={s.sourceFileHash} value={s.sourceFileHash}>
                        {s.styleName}（{s.sourceFileName}）
                      </option>
                    ))}
                  </select>
                  {styleCards.length === 0 && (
                    <span className="hint">
                      还没有文风卡，可先去
                      <Link href="/style" className="faint">
                        {" "}
                        拆书工坊{" "}
                      </Link>
                      拆一本。
                    </span>
                  )}
                </div>
                <div className="field" style={{ margin: 0 }}>
                  <label className="label">设定卡（拆设定）</label>
                  <select
                    className="input"
                    value={archiveId}
                    onChange={(e) => setArchiveId(e.target.value)}
                  >
                    <option value="">不套用设定卡</option>
                    {archives.map((a) => (
                      <option key={a.sourceFileHash} value={a.sourceFileHash}>
                        {a.title}（{a.sourceFileName}）
                      </option>
                    ))}
                  </select>
                  {archives.length === 0 && (
                    <span className="hint">
                      还没有设定卡，可先去
                      <Link href="/style" className="faint">
                        {" "}
                        拆书工坊{" "}
                      </Link>
                      抽一本。
                    </span>
                  )}
                </div>
              </div>
            </section>

            {/* Structure preview + reader */}
            <section
              className="panel"
              style={{ padding: 0, marginBottom: 18, overflow: "hidden" }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(220px, 300px) 1fr",
                  minHeight: 360,
                }}
              >
                <div
                  className="scroll-y"
                  style={{
                    borderRight: "1px solid var(--line)",
                    maxHeight: 480,
                    padding: "8px 0",
                  }}
                >
                  {parsed.volumes.map((v) => (
                    <div key={v.id} style={{ padding: "4px 8px" }}>
                      <div
                        className="faint"
                        style={{
                          fontSize: 12,
                          padding: "6px 8px",
                          fontFamily: "var(--font-serif)",
                        }}
                      >
                        {v.title} · {v.chapters.length} 章
                      </div>
                      {v.chapters.map((c) => {
                        const active = c.id === previewId;
                        return (
                          <button
                            key={c.id}
                            onClick={() => setPreviewId(c.id)}
                            className="nav-chapter"
                            style={{
                              background: active
                                ? "var(--ink-700)"
                                : "transparent",
                              borderLeft: active
                                ? "2px solid var(--cinnabar)"
                                : "2px solid transparent",
                            }}
                          >
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                color: active ? "var(--fg)" : "var(--fg-dim)",
                              }}
                            >
                              {c.title}
                            </span>
                            {c.wordCount > 0 && (
                              <span className="faint" style={{ fontSize: 11 }}>
                                {(c.wordCount / 1000).toFixed(1)}k
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
                <div
                  className="scroll-y"
                  style={{ maxHeight: 480, padding: "18px 22px" }}
                >
                  {previewChapter ? (
                    <>
                      <div className="faint" style={{ fontSize: 12 }}>
                        {previewChapter.v.title}
                      </div>
                      <h3
                        style={{
                          fontSize: 19,
                          margin: "2px 0 14px",
                          fontFamily: "var(--font-serif)",
                        }}
                      >
                        {previewChapter.c.title}
                      </h3>
                      <div
                        className="reader"
                        style={{ whiteSpace: "pre-wrap", lineHeight: 1.9 }}
                      >
                        {previewChapter.c.content || "（本章无正文）"}
                      </div>
                    </>
                  ) : (
                    <p className="faint">选择左侧任意一章，即可在此预览原文。</p>
                  )}
                </div>
              </div>
            </section>

            <div
              style={{
                display: "flex",
                gap: 12,
                alignItems: "center",
                justifyContent: "flex-end",
              }}
            >
              <span className="faint" style={{ fontSize: 13, marginRight: "auto" }}>
                导入后将作为一本新书存入书架，可随时回到工作台阅读与续写。
              </span>
              <button
                className="btn btn--primary"
                onClick={startContinue}
                disabled={creating}
              >
                {creating ? "正在铺纸…" : "导入并开始续写 →"}
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}

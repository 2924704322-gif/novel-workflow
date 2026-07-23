// Parse an imported novel .txt into the app's Volume/Chapter model so the user
// can read it and continue writing from where it ends. Pure and dependency-free
// (browser + Node safe): no Node-only APIs, self-contained id generator.
//
// Strategy: scan line by line, recognizing short "heading" lines as volume or
// chapter markers (Chinese 第N卷/卷N/第N章/第N回…, plus 序章/楔子/尾声/番外 and
// English Chapter/Volume). Content between headings becomes a chapter body,
// marked "done" (it is already written). If no chapter headings are found at
// all, fall back to splitting the whole text into ~fixed-size chapters so the
// book is still navigable.

import type { Chapter, Volume } from "./types";
import { countWords } from "./types";

function uid(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// Arabic + common Chinese numeral characters (incl. formal 壹贰… and 两).
const NUM = "0-9零一二三四五六七八九十百千两壹贰叁肆伍陆柒捌玖拾佰仟";

// A volume marker: 第N卷/部/篇, 卷N, Volume N, Book N.
const VOLUME_RE = new RegExp(
  `^(?:第\\s*[${NUM}]+\\s*[卷部篇]|卷\\s*[${NUM}]+|[Vv]olume\\s*\\d+|Book\\s*\\d+)`
);
// A chapter marker: 第N章/回/节/话, 序章/楔子/尾声/终章/后记/番外, Chapter N.
const CHAPTER_RE = new RegExp(
  `^(?:第\\s*[${NUM}]+\\s*[章回节節话話]|序章|序幕|楔子|尾声|尾聲|终章|終章|后记|後記|番外|[Cc]hapter\\s*\\d+)`
);

const MAX_HEADING_LEN = 50; // headings are their own short line

function isHeading(line: string, re: RegExp): boolean {
  const t = line.trim();
  if (!t || t.length > MAX_HEADING_LEN) return false;
  return re.test(t);
}

export interface ParsedBook {
  volumes: Volume[];
  chapterCount: number;
  volumeCount: number;
  detected: boolean; // true if chapter headings were recognized (false = fallback split)
}

function makeChapter(index: number, title: string, content: string): Chapter {
  const body = content.trim();
  return {
    id: uid(),
    index,
    title: title || `第${index}章`,
    synopsis: "",
    content: body,
    summary: "",
    wordCount: countWords(body),
    status: body ? "done" : "empty",
    updatedAt: Date.now(),
  };
}

// Fallback when the file has no recognizable chapter headings: pour the whole
// text into ~`size`-char chapters along paragraph boundaries.
function fallbackSplit(text: string, size: number): ParsedBook {
  const paras = text
    .replace(/\r\n?/g, "\n")
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const blocks: string[] = [];
  let buf = "";
  for (const p of paras) {
    if (buf && buf.length + p.length + 1 > size) {
      blocks.push(buf);
      buf = "";
    }
    buf += (buf ? "\n" : "") + p;
  }
  if (buf.trim()) blocks.push(buf);
  const chapters = blocks.map((b, i) => makeChapter(i + 1, `第${i + 1}章`, b));
  const vol: Volume = {
    id: uid(),
    index: 1,
    title: "正文",
    summary: "",
    plannedChapters: 0,
    chapters,
  };
  return {
    volumes: chapters.length ? [vol] : [],
    chapterCount: chapters.length,
    volumeCount: chapters.length ? 1 : 0,
    detected: false,
  };
}

/**
 * Parse a novel's raw text into volumes + chapters. Chapters carry their body
 * and are marked "done". `fallbackChapterChars` controls the fallback chunking
 * used only when no chapter headings are detected.
 */
export function parseNovel(text: string, fallbackChapterChars = 3000): ParsedBook {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const hasChapters = lines.some((l) => isHeading(l, CHAPTER_RE));
  if (!hasChapters) return fallbackSplit(text, fallbackChapterChars);

  const volumes: Volume[] = [];
  let curVol: Volume | null = null;
  let curTitle = "";
  let buf: string[] = [];
  let started = false; // whether we have seen the first chapter heading (in any volume)

  const ensureVol = (title: string): Volume => {
    curVol = {
      id: uid(),
      index: volumes.length + 1,
      title: title || `第${volumes.length + 1}卷`,
      summary: "",
      plannedChapters: 0,
      chapters: [],
    };
    volumes.push(curVol);
    return curVol;
  };
  const pushChap = (title: string, content: string) => {
    if (!curVol) ensureVol("正文");
    const v = curVol as Volume;
    v.chapters.push(makeChapter(v.chapters.length + 1, title, content));
  };

  for (const line of lines) {
    const t = line.trim();
    if (isHeading(line, VOLUME_RE)) {
      if (started && curTitle) pushChap(curTitle, buf.join("\n"));
      buf = [];
      curTitle = "";
      started = false;
      ensureVol(t);
      continue;
    }
    if (isHeading(line, CHAPTER_RE)) {
      if (!started) {
        // preface text before the first chapter (of this volume). Keep it only
        // if substantial; short lines are usually title / author metadata.
        const pre = buf.join("\n").trim();
        if (pre.length >= 200) pushChap("序章", pre);
      } else if (curTitle) {
        pushChap(curTitle, buf.join("\n"));
      }
      buf = [];
      curTitle = t;
      started = true;
      continue;
    }
    buf.push(line);
  }
  if (started && curTitle) pushChap(curTitle, buf.join("\n"));

  // Drop empty volumes and renumber so indexes stay contiguous.
  const cleaned = volumes
    .filter((v) => v.chapters.length > 0)
    .map((v, i) => ({
      ...v,
      index: i + 1,
      chapters: v.chapters.map((c, j) => ({ ...c, index: j + 1 })),
    }));
  const chapterCount = cleaned.reduce((n, v) => n + v.chapters.length, 0);

  // If parsing somehow yielded nothing usable, fall back rather than return empty.
  if (chapterCount === 0) return fallbackSplit(text, fallbackChapterChars);

  return {
    volumes: cleaned,
    chapterCount,
    volumeCount: cleaned.length,
    detected: true,
  };
}

// 导出模块 —— EPUB 电子书导出（使用 epub-gen-memory）。

import type { Project, Volume } from "../types";
import type { ExportOptions } from "./types";

interface EpubChapter {
  title: string;
  content: string;
}

/**
 * 将作品导出为 EPUB Buffer。
 */
export async function exportAsEpub(
  project: Project,
  options: ExportOptions
): Promise<Buffer> {
  // 动态 import，避免客户端打包尝试解析此 Node-only 模块
  const { default: EPub } = await import("epub-gen-memory") as any;

  const volumes =
    options.scope === "volume" && options.volumeIndex != null
      ? [project.volumes[options.volumeIndex]].filter(Boolean)
      : project.volumes;

  const chapters: EpubChapter[] = [];

  // 可选前言/设定页
  if (options.includeOutline && project.bible) {
    const lines: string[] = [];
    lines.push(`<h2>故事设定</h2>`);
    lines.push(`<p><strong>内核</strong>：${escHtml(project.bible.logline)}</p>`);
    if (project.bible.synopsis) {
      lines.push(`<p><strong>梗概</strong>：${escHtml(project.bible.synopsis)}</p>`);
    }
    if (project.bible.worldbuilding) {
      lines.push(`<p><strong>世界观</strong>：${escHtml(project.bible.worldbuilding)}</p>`);
    }
    chapters.push({ title: "故事设定", content: lines.join("\n") });
  }

  // 各卷各章
  for (const vol of volumes) {
    // 卷标题页
    chapters.push({
      title: `第${vol.index}卷 ${vol.title}`,
      content: buildVolumeHtml(vol, options),
    });

    for (const ch of vol.chapters) {
      chapters.push({
        title: `第${ch.index}章 ${ch.title}`,
        content: buildChapterHtml(ch.content, ch.synopsis, options),
      });
    }
  }

  const epub = new EPub(
    {
      title: project.title,
      author: "墨章 Novel Atelier",
      description: project.bible?.logline || "",
      lang: "zh-CN",
    },
    chapters.map((c) => ({ title: c.title, content: c.content }))
  );

  return epub.genEpub();
}

function buildVolumeHtml(vol: Volume, options: ExportOptions): string {
  const lines: string[] = [];
  lines.push(`<h2>第${vol.index}卷 ${escHtml(vol.title)}</h2>`);
  if (options.includeNotes && vol.summary) {
    lines.push(`<blockquote>${escHtml(vol.summary)}</blockquote>`);
  }
  return lines.join("\n");
}

function buildChapterHtml(
  content: string,
  synopsis: string,
  options: ExportOptions
): string {
  const lines: string[] = [];
  if (options.includeNotes && synopsis) {
    lines.push(`<blockquote><em>${escHtml(synopsis)}</em></blockquote>`);
  }
  if (content) {
    // 将正文按段落转为 <p> 标签
    const paragraphs = content.split(/\n\s*\n/).filter((p) => p.trim());
    for (const p of paragraphs) {
      lines.push(`<p>${escHtml(p.trim()).replace(/\n/g, "<br/>")}</p>`);
    }
  } else {
    lines.push(`<p><em>（未写）</em></p>`);
  }
  return lines.join("\n");
}

function escHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

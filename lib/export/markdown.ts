// 导出模块 —— Markdown 导出（含 YAML front-matter）。

import type { Project } from "../types";
import type { ExportOptions } from "./types";

/**
 * 将作品导出为 Markdown 格式字符串。
 */
export function exportAsMarkdown(project: Project, options: ExportOptions): string {
  const parts: string[] = [];

  // YAML front-matter
  parts.push("---");
  parts.push(`title: "${project.title}"`);
  parts.push(`genre: "${project.setup.genre}"`);
  parts.push(`created: ${new Date(project.createdAt).toISOString().slice(0, 10)}`);
  parts.push(`exported: ${new Date().toISOString().slice(0, 10)}`);
  parts.push("---");
  parts.push("");

  parts.push(`# ${project.title}`);
  parts.push("");

  if (options.includeOutline && project.bible) {
    parts.push("## 故事设定");
    parts.push("");
    parts.push(`**内核**：${project.bible.logline}`);
    parts.push("");
    if (project.bible.synopsis) {
      parts.push(`**梗概**：${project.bible.synopsis}`);
      parts.push("");
    }
    if (project.bible.worldbuilding) {
      parts.push(`**世界观**：${project.bible.worldbuilding}`);
      parts.push("");
    }
    if (project.bible.themes) {
      parts.push(`**主题**：${project.bible.themes}`);
      parts.push("");
    }
    parts.push("---");
    parts.push("");
  }

  const volumes =
    options.scope === "volume" && options.volumeIndex != null
      ? [project.volumes[options.volumeIndex]].filter(Boolean)
      : project.volumes;

  for (const vol of volumes) {
    parts.push(`## 第${vol.index}卷 ${vol.title}`);
    parts.push("");

    if (options.includeNotes && vol.summary) {
      parts.push(`> ${vol.summary}`);
      parts.push("");
    }

    for (const ch of vol.chapters) {
      parts.push(`### 第${ch.index}章 ${ch.title}`);
      parts.push("");

      if (options.includeNotes && ch.synopsis) {
        parts.push(`> *${ch.synopsis}*`);
        parts.push("");
      }

      if (ch.content) {
        parts.push(ch.content);
      } else {
        parts.push("*（未写）*");
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}

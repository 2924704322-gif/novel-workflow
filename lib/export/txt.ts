// 导出模块 —— TXT 纯文本导出。

import type { Project } from "../types";
import type { ExportOptions } from "./types";

/**
 * 将作品导出为纯文本字符串。
 */
export function exportAsTxt(project: Project, options: ExportOptions): string {
  const parts: string[] = [];

  parts.push(project.title);
  parts.push("=".repeat(project.title.length * 2));
  parts.push("");

  if (options.includeOutline && project.bible) {
    parts.push("【故事设定】");
    parts.push(`内核：${project.bible.logline}`);
    if (project.bible.synopsis) parts.push(`梗概：${project.bible.synopsis}`);
    parts.push("");
  }

  const volumes =
    options.scope === "volume" && options.volumeIndex != null
      ? [project.volumes[options.volumeIndex]].filter(Boolean)
      : project.volumes;

  for (const vol of volumes) {
    parts.push(`\n${"─".repeat(20)}`);
    parts.push(`第${vol.index}卷 ${vol.title}`);
    parts.push(`${"─".repeat(20)}\n`);

    if (options.includeNotes && vol.summary) {
      parts.push(`[卷概要] ${vol.summary}\n`);
    }

    for (const ch of vol.chapters) {
      parts.push(`\n第${ch.index}章 ${ch.title}\n`);
      if (options.includeNotes && ch.synopsis) {
        parts.push(`[章概要] ${ch.synopsis}\n`);
      }
      if (ch.content) {
        parts.push(ch.content);
      } else {
        parts.push("（未写）");
      }
      parts.push("");
    }
  }

  return parts.join("\n");
}

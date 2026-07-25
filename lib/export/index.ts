// 导出模块 —— 统一入口。

import type { Project } from "../types";
import type { ExportFormat, ExportOptions } from "./types";
import { DEFAULT_EXPORT_OPTIONS } from "./types";
import { exportAsTxt } from "./txt";
import { exportAsMarkdown } from "./markdown";
import { exportAsEpub } from "./epub";

export type { ExportFormat, ExportOptions } from "./types";
export { DEFAULT_EXPORT_OPTIONS } from "./types";

export interface ExportResult {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * 导出作品为指定格式。
 */
export async function exportProject(
  project: Project,
  format: ExportFormat,
  options?: Partial<ExportOptions>
): Promise<ExportResult> {
  const opts: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  const safeName = project.title.replace(/[/\\?%*:|"<>]/g, "_");

  switch (format) {
    case "epub": {
      const buffer = await exportAsEpub(project, opts);
      return {
        buffer,
        filename: `${safeName}.epub`,
        contentType: "application/epub+zip",
      };
    }
    case "markdown": {
      const text = exportAsMarkdown(project, opts);
      return {
        buffer: Buffer.from(text, "utf-8"),
        filename: `${safeName}.md`,
        contentType: "text/markdown; charset=utf-8",
      };
    }
    case "txt": {
      const text = exportAsTxt(project, opts);
      return {
        buffer: Buffer.from(text, "utf-8"),
        filename: `${safeName}.txt`,
        contentType: "text/plain; charset=utf-8",
      };
    }
    default:
      throw new Error(`不支持的导出格式：${format}`);
  }
}

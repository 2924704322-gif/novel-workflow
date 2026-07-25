// 导出模块 —— 类型定义。

export type ExportFormat = "epub" | "markdown" | "txt";

export interface ExportOptions {
  /** 全书 or 按卷拆分。 */
  scope: "full" | "volume";
  /** scope=volume 时指定卷序号（0-based）。 */
  volumeIndex?: number;
  /** 是否包含大纲/设定信息作为附录。 */
  includeOutline?: boolean;
  /** 是否包含作者备注（前言/章节概要）。 */
  includeNotes?: boolean;
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  scope: "full",
  includeOutline: false,
  includeNotes: false,
};

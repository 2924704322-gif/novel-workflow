// 提示词构造模块（按领域拆分子文件，本文件为 barrel 再导出）。
//
// 原 lib/prompts.ts 的内容已按领域拆分到 lib/prompts/* 子文件：
//   - shared.ts    ：共享常量与私有辅助函数 + extractJson
//   - bible.ts     ：buildBiblePrompt
//   - volume.ts    ：buildVolumesPrompt / buildVolumeChaptersPrompt / buildVolumeArcPrompt / buildStorySoFarPrompt
//   - chapter.ts   ：buildChapterOutlinePrompt / buildChapterPrompt
//   - digest.ts    ：buildDigestPrompt
//   - reconcile.ts ：buildReconcilePrompt
//   - style.ts     ：buildStyleAnalyzePrompt
//   - archive.ts   ：buildArchiveAnalyzePrompt / buildArchiveReducePrompt
//
// 公开 API 与重构前完全一致：所有 build* 函数与 extractJson 均可从本文件导入。

export { extractJson } from "./prompts/shared";
export * from "./prompts/bible";
export * from "./prompts/volume";
export * from "./prompts/chapter";
export * from "./prompts/digest";
export * from "./prompts/reconcile";
export * from "./prompts/style";
export * from "./prompts/archive";

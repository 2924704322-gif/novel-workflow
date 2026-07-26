// Agent 工具注册表（系统规范 §3.4）。A/B/C/D 四组工具，全部映射到 lib/ 中的
// 真实符号：数据经 projectRepository，生成复用 prompt 构造 + completeChat，
// 记忆/检索直调 lib/retrieval 与 lib/reconcile 的纯函数。**不重写小说逻辑。**
//
// 工具分两类（§3.5 Human-in-the-loop）：
//  - write=false：只读 / 生成候选，Agent 可自由调用，run() 立即返回结果。
//  - write=true ：写操作，先 propose() 产出变更提案（不落库），用户确认后 apply()。
//
// 原 lib/agent/tools.ts 已按分组拆分为子文件（tools-data / tools-generate /
// tools-memory / tools-analysis），各工具定义与 tools-shared（上下文/类型/折叠
// 逻辑/内部小工具）均搬至子文件；本文件只做注册与公共 API 的再导出。
// 公共 API 与重构前完全一致。

import {
  list_projects,
  get_project,
  create_project,
  save_project,
  delete_project,
} from "./tools-data";
import {
  generate_bible,
  generate_volumes,
  generate_volume,
  generate_chapter_outline,
  generate_chapter,
  digest_chapter,
  generate_recap,
  reconcile,
} from "./tools-generate";
import {
  build_chapter_context,
  query_codex,
  apply_digest,
  apply_reconcile,
} from "./tools-memory";
import {
  analyze_style,
  analyze_archive,
  list_style_cards,
  list_archives,
} from "./tools-analysis";

// 公共类型与折叠逻辑（原为文件内导出，现由 tools-shared 提供，此处再导出以保持 API 不变）。
import type { AgentTool } from "./tools-shared";
export {
  type ToolContext,
  type GeneratedEntry,
  type GeneratedCache,
  type AgentTool,
  foldGenerated,
} from "./tools-shared";

// ---- 注册表 ----------------------------------------------------------------

export const AGENT_TOOLS: AgentTool[] = [
  // A. 数据 / 项目
  list_projects,
  get_project,
  create_project,
  save_project,
  delete_project,
  // B. 生成 / 工作流
  generate_bible,
  generate_volumes,
  generate_volume,
  generate_chapter_outline,
  generate_chapter,
  digest_chapter,
  generate_recap,
  reconcile,
  // C. 记忆 / 检索
  build_chapter_context,
  query_codex,
  apply_digest,
  apply_reconcile,
  // D. 拆书学 / 卡库
  analyze_style,
  analyze_archive,
  list_style_cards,
  list_archives,
];

export const TOOLS_BY_NAME: Record<string, AgentTool> = Object.fromEntries(
  AGENT_TOOLS.map((t) => [t.name, t])
);

// OpenAI 兼容 function-calling 的工具声明（供 chat/completions 的 tools 字段）。
export function toolSchemas() {
  return AGENT_TOOLS.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

// 按白名单过滤后的工具声明（Skill 模式使用）。whitelist 为空或 undefined 时返回全部。
export function toolSchemasFiltered(whitelist?: string[]) {
  if (!whitelist || whitelist.length === 0) return toolSchemas();
  const allowed = new Set(whitelist);
  return AGENT_TOOLS.filter((t) => allowed.has(t.name)).map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

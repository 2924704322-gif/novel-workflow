// 全局语义化常量。
//
// 本文件为纯常量，不引入任何服务端专有依赖（如 next/server、node:*），
// 因此服务端代码（app/api/*）与客户端组件（components/*）均可安全引用。
// 重构自各处的魔法字面量，仅做集中命名，不改变任何取值与行为。

/** 模型单次生成的最大 token 数（原散落在 tools/llm/generate 路由中的 8192）。 */
export const LLM_MAX_TOKENS = 8192;

/** 普通对话轮次内 Agent 工具循环的最大步数。 */
export const AGENT_MAX_STEPS = 8;

/** Skill 模式下 Agent 工具循环的最大步数（预期步骤更多）。 */
export const AGENT_MAX_STEPS_SKILL = 12; // Skill 模式预期步骤更多

/** reconcile 单次下传章节的上限（原 lib/reconcile.ts 的 MAX_CHAPTERS）。 */
export const RECONCILE_CHAPTER_CAP = 60;

/** completeChat / streamChat 在配置未提供 temperature 时使用的默认值。 */
export const LLM_DEFAULT_TEMPERATURE = 0.8;

/** 客户端默认 API 配置的 temperature（原 lib/client.ts DEFAULT_CONFIG）。 */
export const CLIENT_DEFAULT_TEMPERATURE = 0.85;

/** Agent 运行时在配置未提供 temperature 时使用的默认值。 */
export const AGENT_RUNTIME_TEMPERATURE = 0.7;

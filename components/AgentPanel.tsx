"use client";

import AgentChat from "@/components/AgentChat";

/**
 * 右侧常驻「创作助手」栏位。
 *
 * 阶段一已接入：直接承载真实对话组件 `AgentChat`（默认走 `/api/agent/chat` 的
 * NDJSON 流式端点，写操作走「变更提案 → 确认」闭环）。本组件只作薄包装，
 * 负责把三栏外壳的收起回调透传给 `AgentChat`，并以 `flush` 让其贴边填满栏位、
 * 与右栏边框自然衔接（不再自带卡片圆角）。
 *
 * 独立开发预览页 `app/agent` 仍以默认卡片外观使用 `AgentChat`，两处互不影响。
 */
export default function AgentPanel({ onCollapse }: { onCollapse: () => void }) {
  return <AgentChat flush onCollapse={onCollapse} />;
}

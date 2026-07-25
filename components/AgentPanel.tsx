"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import AgentChat from "@/components/AgentChat";
import RoleplayChat from "@/components/RoleplayChat";

/**
 * 右侧常驻面板 —— 双 Tab：「助手」（Agent 工具编排）和「角色对话」（Roleplay 沉浸式对话）。
 *
 * - 助手 tab：承载真实对话组件 AgentChat（走 /api/agent/chat 的 NDJSON 流）
 * - 角色对话 tab：仅在有作品上下文时可用（从 URL pathname 推断 projectId），
 *   展示 RoleplayChat 沉浸式 1v1 对话面板
 *
 * 独立开发预览页 `app/agent` 仍以默认卡片外观使用 `AgentChat`，两处互不影响。
 */

type PanelTab = "agent" | "roleplay";

export default function AgentPanel({ onCollapse }: { onCollapse: () => void }) {
  const [tab, setTab] = useState<PanelTab>("agent");
  const pathname = usePathname();

  // 从路径推断当前作品 id（/project/[id] 格式）
  const projectId = extractProjectId(pathname);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Tab 切换栏 */}
      <div style={S.tabBar}>
        <button
          style={{ ...S.tab, ...(tab === "agent" ? S.tabActive : {}) }}
          onClick={() => setTab("agent")}
        >
          助手
        </button>
        <button
          style={{ ...S.tab, ...(tab === "roleplay" ? S.tabActive : {}) }}
          onClick={() => setTab("roleplay")}
          disabled={!projectId}
          title={projectId ? "角色对话" : "需先打开一部作品"}
        >
          角色对话
        </button>
        <span style={{ flex: 1 }} />
        <button style={S.collapseBtn} onClick={onCollapse} title="收起">
          ✕
        </button>
      </div>

      {/* 内容区 */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab === "agent" && <AgentChat flush projectId={projectId || undefined} />}
        {tab === "roleplay" && projectId && (
          <RoleplayChat flush projectId={projectId} />
        )}
        {tab === "roleplay" && !projectId && (
          <div style={S.noProject}>请先打开一部作品，再使用角色对话。</div>
        )}
      </div>
    </div>
  );
}

function extractProjectId(pathname: string): string | null {
  const m = pathname.match(/\/project\/([^/]+)/);
  return m ? m[1] : null;
}

const S: Record<string, React.CSSProperties> = {
  tabBar: {
    display: "flex",
    alignItems: "center",
    gap: 0,
    borderBottom: "1px solid var(--line)",
    background: "var(--ink-900)",
    padding: "0 8px",
  },
  tab: {
    padding: "8px 14px",
    fontSize: 13,
    fontWeight: 500,
    color: "var(--fg-dim)",
    background: "none",
    border: "none",
    borderBottom: "2px solid transparent",
    cursor: "pointer",
    transition: "color 0.15s, border-color 0.15s",
  },
  tabActive: {
    color: "var(--fg)",
    borderBottomColor: "var(--cinnabar)",
  },
  collapseBtn: {
    background: "none",
    border: "none",
    color: "var(--fg-dim)",
    cursor: "pointer",
    fontSize: 14,
    padding: "6px 8px",
  },
  noProject: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--fg-dim)",
    fontSize: 14,
  },
};

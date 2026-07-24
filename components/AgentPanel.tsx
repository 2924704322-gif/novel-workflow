"use client";

import { useState } from "react";

/**
 * 右侧常驻「创作助手」对话面板。
 *
 * 现阶段为 UI 外壳 + 占位空状态：后端 Agent 运行时（`/api/agent/chat`）尚未实现，
 * 因此输入框与发送按钮暂禁用。消息列表、输入区、发送回调的结构已按未来接入预留——
 * 接上 Agent 时只需在 send() 里发起流式请求，并把增量往 messages 里追加即可，
 * 外层布局与样式无需再动。
 */
type ChatMsg = { role: "user" | "assistant"; content: string };

export default function AgentPanel({ onCollapse }: { onCollapse: () => void }) {
  const [input, setInput] = useState("");
  // 预留：接入后此处改为真实会话状态（useChat / 自管 messages）。
  const [messages] = useState<ChatMsg[]>([]);

  return (
    <div className="agentpanel">
      <div className="agentpanel-head">
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <span className="seal seal--sm" aria-hidden>
            助
          </span>
          <span style={{ display: "grid", lineHeight: 1.2 }}>
            <span style={{ fontFamily: "var(--font-serif)", fontSize: 15 }}>
              创作助手
            </span>
            <span className="faint" style={{ fontSize: 11 }}>
              对话驱动 · 工具调用
            </span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span className="chip" style={{ fontSize: 11 }}>
            后端待接入
          </span>
          <button
            className="btn btn--ghost btn--sm"
            onClick={onCollapse}
            title="收起助手"
            aria-label="收起助手"
          >
            ›
          </button>
        </div>
      </div>

      <div className="agentpanel-body scroll-y">
        {messages.length === 0 ? (
          <div className="agent-empty fadeup">
            <p style={{ marginTop: 0 }}>
              这里将是你的<b style={{ color: "var(--fg)" }}>创作助手</b>——
              用大白话吩咐它，它来调动整套小说工作流。
            </p>
            <div className="agent-caps">
              <span className="chip">新建作品</span>
              <span className="chip">生成设定集</span>
              <span className="chip">生成分卷脉络</span>
              <span className="chip">续写正文</span>
              <span className="chip">检索问答</span>
            </div>
            <p style={{ marginBottom: 0 }}>
              涉及改动作品的操作（保存、删除、折回、正文落库）都会先给出
              <b style={{ color: "var(--fg)" }}>变更提案</b>，等你确认后才真正落库，
              已写正文永不自动覆盖。
            </p>
            <p className="faint" style={{ fontSize: 12.5 }}>
              助手后端（Agent 运行时）尚在搭建中，先把外壳摆好——接入后此处即可对话。
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {messages.map((m, i) => (
              <div
                key={i}
                className={m.role === "user" ? "agent-msg agent-msg--me" : "agent-msg"}
              >
                {m.content}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="agentpanel-input">
        <textarea
          className="textarea"
          rows={3}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled
          placeholder="Agent 后端待接入（阶段一）……接入后可用自然语言驱动：新建书 → 生成设定 → 生成脉络 → 续写"
          style={{ fontSize: 13.5 }}
        />
        <button
          className="btn btn--primary btn--sm"
          disabled
          style={{ width: "100%", marginTop: 8 }}
          title="Agent 后端待接入"
        >
          发送（待接入）
        </button>
      </div>
    </div>
  );
}

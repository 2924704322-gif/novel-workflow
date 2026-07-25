"use client";

// AgentChat —— 墨章本地 Agent 对话面板（Sub B）。
// 消息列表 + 流式渲染 + 工具活动 + 写操作提案确认流 + 输入框。
// 数据流全部走 useChat；默认走真实 /api/agent/chat（NDJSON，经 apiBase 接缝①），
// 传入 transport 可覆盖（如联调/演示时换成 mockChatStream）。
// 视觉沿用「暖阁」暖色调与衬线标题，可整块嵌入右侧 AgentPanel 位。

import { useEffect, useMemo, useRef, useState } from "react";
import type { ApiConfig } from "@/lib/types";
import { loadConfig, getApiBase } from "@/lib/client";
import type { ChangeProposal, ChatMessage } from "@/lib/agent/types";
import { useChat } from "@/lib/agent/useChat";
import { httpChatStream, type ChatTransport } from "@/lib/agent/mockStream";
import SkillPicker from "./SkillPicker";
import { SKILLS_BY_ID } from "@/lib/agent/skills";

export interface AgentChatProps {
  projectId?: string;
  config?: ApiConfig; // 不传则读当前生效档
  transport?: ChatTransport; // 不传则走真实 /api/agent/chat；可覆盖为 mockChatStream
  onCollapse?: () => void; // 传入则在 header 末尾出「收起」按钮（供右栏 AgentPanel 嵌入）
  flush?: boolean; // 嵌入三栏右栏时去掉外框圆角、贴边填满栏位
}

export default function AgentChat({ projectId, config, transport, onCollapse, flush }: AgentChatProps) {
  // config 只在首挂载时定一次，避免每次渲染 new 对象触发 useChat 重建。
  const [resolvedConfig] = useState<ApiConfig>(() => config ?? loadConfig());
  // 传输层同理只定一次：默认真实 NDJSON 端点，apiBase 走接缝①（缺省即相对路径）。
  const [resolvedTransport] = useState<ChatTransport>(
    () => transport ?? httpChatStream(getApiBase())
  );

  const chat = useChat({ config: resolvedConfig, transport: resolvedTransport, projectId });
  const { messages, streaming, streamingText, toolActivity, proposals, error, activeSkill } = chat;

  const [input, setInput] = useState("");
  const [showSkills, setShowSkills] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 新消息 / 流式增量 / 提案变化时滚到底部。
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, toolActivity, proposals]);

  const empty = messages.length === 0 && !streaming;

  function submit() {
    if (!input.trim() || streaming) return;
    chat.send(input);
    setInput("");
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div style={flush ? { ...S.root, border: "none", borderRadius: 0, flex: "1 1 auto", minWidth: 0 } : S.root}>
      <style>{"@keyframes agentCaretBlink{0%,100%{opacity:1}50%{opacity:0}}"}</style>
      <header style={S.header}>
        <span className="seal seal--sm">章</span>
        <div style={{ display: "grid", lineHeight: 1.2 }}>
          <strong style={{ fontFamily: "var(--font-serif)", fontSize: 15 }}>写作助手</strong>
          <span style={{ fontSize: 11, color: "var(--fg-faint)" }}>
            {projectId ? `作品 ${projectId}` : "未绑定作品 · 自然语言驱动"}
          </span>
        </div>
        <button
          className="btn btn--ghost btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={chat.reset}
          disabled={streaming}
          title="清空当前会话"
        >
          清空
        </button>
        {onCollapse && (
          <button
            className="btn btn--ghost btn--sm"
            style={{ marginLeft: 6 }}
            onClick={onCollapse}
            title="收起助手"
            aria-label="收起助手"
          >
            ›
          </button>
        )}
      </header>

      <div ref={scrollRef} style={S.scroll}>
        {empty && (
          <div style={S.hint}>
            <p className="muted" style={{ margin: 0 }}>
              用大白话告诉我要做什么，比如：
            </p>
            <ul style={{ margin: "10px 0 0", paddingLeft: 18, color: "var(--fg-dim)" }}>
              <li>新建一本叫《春山纪》的书，先立个骨架</li>
              <li>给这本书生成设定集</li>
              <li>排一下分卷脉络</li>
              <li>续写第三章的草稿</li>
            </ul>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}

        {/* 流式进行中的助手气泡 */}
        {streaming && (streamingText || toolActivity.length > 0) && (
          <div style={S.rowLeft}>
            <div style={S.bubbleAssistant}>
              {toolActivity.length > 0 && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: streamingText ? 8 : 0 }}>
                  {toolActivity.map((t, i) => (
                    <ToolChip key={i} name={t.name} done={t.done} />
                  ))}
                </div>
              )}
              {streamingText && (
                <span style={{ whiteSpace: "pre-wrap" }}>
                  {streamingText}
                  <span style={S.caret} />
                </span>
              )}
            </div>
          </div>
        )}

        {/* 纯思考态：还没吐字也没工具时给个点状态 */}
        {streaming && !streamingText && toolActivity.length === 0 && (
          <div style={S.rowLeft}>
            <div style={S.bubbleAssistant}>
              <span className="muted">思考中…</span>
            </div>
          </div>
        )}

        {/* 待确认的写操作提案 */}
        {proposals.map((p) => (
          <ProposalCard
            key={p.id}
            proposal={p}
            disabled={streaming}
            onConfirm={() => chat.confirm(p.id, true)}
            onCancel={() => chat.confirm(p.id, false)}
          />
        ))}

        {error && (
          <div style={S.error}>
            <span className="dot dot--draft" /> {error}
          </div>
        )}
      </div>

      <div style={S.composer}>
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
          {showSkills && (
            <SkillPicker
              disabled={streaming}
              onSelect={(id, params) => {
                setShowSkills(false);
                chat.runSkill(id, params);
              }}
            />
          )}
          {activeSkill && (
            <div style={S.skillBadge}>
              技能执行中：{SKILLS_BY_ID[activeSkill]?.name || activeSkill}
            </div>
          )}
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            placeholder={streaming ? "助手正在回复…" : "说点什么…（Enter 发送，Shift+Enter 换行）"}
            style={S.textarea}
          />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            className="btn btn--ghost btn--sm"
            onClick={() => setShowSkills(!showSkills)}
            disabled={streaming}
            title="技能"
            style={{ fontSize: 12 }}
          >
            {showSkills ? "收起" : "技能"}
          </button>
          {streaming ? (
            <button className="btn btn--ghost btn--sm" onClick={chat.stop}>
              停止
            </button>
          ) : (
            <button className="btn btn--primary btn--sm" onClick={submit} disabled={!input.trim()}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div style={S.rowRight}>
        <div style={S.bubbleUser}>{message.content}</div>
      </div>
    );
  }
  // assistant / tool
  return (
    <div style={S.rowLeft}>
      <div style={S.bubbleAssistant}>
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: message.content ? 8 : 0 }}>
            {message.toolCalls.map((t, i) => (
              <ToolChip key={i} name={t.name} done={t.result !== undefined} />
            ))}
          </div>
        )}
        {message.content && <span style={{ whiteSpace: "pre-wrap" }}>{message.content}</span>}
      </div>
    </div>
  );
}

function ToolChip({ name, done }: { name: string; done: boolean }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        fontSize: 11,
        padding: "2px 9px",
        borderRadius: 999,
        border: "1px solid var(--line-strong)",
        background: done ? "rgba(111,144,104,0.12)" : "rgba(211,162,76,0.14)",
        color: "var(--fg-dim)",
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: done ? "var(--jade)" : "var(--gold)",
        }}
      />
      {done ? "工具完成" : "调用工具"}·{name}
    </span>
  );
}

function ProposalCard({
  proposal,
  disabled,
  onConfirm,
  onCancel,
}: {
  proposal: ChangeProposal;
  disabled: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const diff = useMemo(() => renderDiff(proposal.diff), [proposal.diff]);
  return (
    <div className="panel" style={S.proposal}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span className="chip chip--cinnabar">待确认改动</span>
        <span style={{ fontSize: 12, color: "var(--fg-faint)" }}>{proposal.tool}</span>
      </div>
      <p style={{ margin: "0 0 10px", fontSize: 14 }}>{proposal.changeSummary}</p>
      {diff}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button className="btn btn--primary btn--sm" onClick={onConfirm} disabled={disabled}>
          确认写入
        </button>
        <button className="btn btn--ghost btn--sm" onClick={onCancel} disabled={disabled}>
          取消
        </button>
      </div>
    </div>
  );
}

function renderDiff(diff: unknown): React.ReactNode {
  if (!diff) return null;
  if (typeof diff === "object" && diff !== null && "before" in diff && "after" in diff) {
    const d = diff as { before?: unknown; after?: unknown };
    return (
      <div style={{ display: "grid", gap: 6 }}>
        <pre style={{ ...S.diffBox, borderColor: "rgba(197,106,63,.3)" }}>
          − {String(d.before ?? "")}
        </pre>
        <pre style={{ ...S.diffBox, borderColor: "rgba(111,144,104,.4)" }}>
          + {String(d.after ?? "")}
        </pre>
      </div>
    );
  }
  return <pre style={S.diffBox}>{JSON.stringify(diff, null, 2)}</pre>;
}

const S: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    background: "linear-gradient(180deg, var(--ink-800), var(--ink))",
    border: "1px solid var(--line)",
    borderRadius: "var(--radius)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "12px 14px",
    borderBottom: "1px solid var(--line)",
    background: "rgba(250,244,231,0.6)",
  },
  scroll: { flex: 1, minHeight: 0, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 },
  hint: { padding: "6px 2px" },
  rowRight: { display: "flex", justifyContent: "flex-end" },
  rowLeft: { display: "flex", justifyContent: "flex-start" },
  bubbleUser: {
    maxWidth: "82%",
    padding: "9px 13px",
    borderRadius: "12px 12px 3px 12px",
    background: "linear-gradient(160deg, var(--cinnabar), var(--cinnabar-deep))",
    color: "#fdeee7",
    whiteSpace: "pre-wrap",
    fontSize: 14,
  },
  bubbleAssistant: {
    maxWidth: "88%",
    padding: "10px 13px",
    borderRadius: "12px 12px 12px 3px",
    background: "var(--ink-800)",
    border: "1px solid var(--line)",
    color: "var(--fg)",
    fontSize: 14,
  },
  caret: {
    display: "inline-block",
    width: 7,
    height: 15,
    marginLeft: 2,
    verticalAlign: "text-bottom",
    background: "var(--cinnabar)",
    animation: "agentCaretBlink 1s step-start infinite",
  },
  proposal: { padding: 14 },
  diffBox: {
    margin: 0,
    padding: "8px 10px",
    fontSize: 12.5,
    lineHeight: 1.5,
    background: "var(--paper)",
    color: "var(--paper-ink)",
    border: "1px solid var(--line)",
    borderRadius: 8,
    whiteSpace: "pre-wrap",
    fontFamily: "var(--font-sans)",
  },
  error: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 12px",
    borderRadius: 8,
    border: "1px solid rgba(197,106,63,.4)",
    background: "rgba(197,106,63,.08)",
    color: "var(--cinnabar-deep)",
    fontSize: 13,
  },
  composer: {
    display: "flex",
    gap: 8,
    alignItems: "flex-end",
    padding: 12,
    borderTop: "1px solid var(--line)",
    background: "rgba(250,244,231,0.6)",
  },
  skillBadge: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 10px",
    borderRadius: 6,
    background: "rgba(211,162,76,0.15)",
    border: "1px solid rgba(211,162,76,0.3)",
    fontSize: 12,
    color: "var(--fg-dim)",
  },
  textarea: {
    flex: 1,
    resize: "none",
    padding: "9px 11px",
    borderRadius: 8,
    border: "1px solid var(--line-strong)",
    background: "var(--ink-800)",
    color: "var(--fg)",
    fontSize: 14,
    lineHeight: 1.5,
  },
};

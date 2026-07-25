"use client";

// RoleplayChat —— 沉浸式角色对话面板。
// 1v1 对话界面：选择角色 → 沉浸式多轮对话。
// 视觉上与 AgentChat 风格一致（暖阁暖色调），但更简洁（无工具/提案面板）。

import { useEffect, useRef, useState } from "react";
import type { ApiConfig, CodexEntry } from "@/lib/types";
import { loadConfig, getApiBase } from "@/lib/client";
import { useRoleplay } from "@/lib/roleplay/useRoleplay";
import type { RoleplayMessage } from "@/lib/roleplay/types";

interface CharInfo {
  codexId: string;
  name: string;
  summary: string;
}

export interface RoleplayChatProps {
  projectId: string;
  config?: ApiConfig;
  characters?: CharInfo[];       // 外部传入则不自行加载
  onCollapse?: () => void;
  flush?: boolean;
}

export default function RoleplayChat({
  projectId,
  config,
  characters: externalChars,
  onCollapse,
  flush,
}: RoleplayChatProps) {
  const [resolvedConfig] = useState<ApiConfig>(() => config ?? loadConfig());
  const [selectedChar, setSelectedChar] = useState<string | null>(null);
  const [characters, setCharacters] = useState<CharInfo[]>(externalChars || []);
  const [loading, setLoading] = useState(!externalChars);

  // 自动加载角色列表（从项目 codex 中筛选人物类型条目）
  useEffect(() => {
    if (externalChars) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/projects/${projectId}`);
        if (!res.ok) return;
        const project = await res.json();
        const chars: CharInfo[] = (project.codex || [])
          .filter((e: CodexEntry) => e.category === "人物" && e.summary)
          .map((e: CodexEntry) => ({ codexId: e.id, name: e.name, summary: e.summary }));
        if (!cancelled) setCharacters(chars);
      } catch { /* ignore */ }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [projectId, externalChars]);

  // 选角后挂载对话面板
  if (!selectedChar) {
    return (
      <div style={{ ...S.outer, ...(flush ? S.flush : {}) }}>
        <Header onCollapse={onCollapse} title="角色对话" />
        {loading ? (
          <div style={S.emptyState}>加载角色列表…</div>
        ) : (
          <CharacterSelect
            characters={characters}
            onSelect={(id) => setSelectedChar(id)}
          />
        )}
      </div>
    );
  }

  return (
    <div style={{ ...S.outer, ...(flush ? S.flush : {}) }}>
      <Header
        onCollapse={onCollapse}
        title={characters.find((c) => c.codexId === selectedChar)?.name || "对话中"}
        onBack={() => setSelectedChar(null)}
      />
      <ChatPanel
        config={resolvedConfig}
        projectId={projectId}
        characterId={selectedChar}
        characterName={characters.find((c) => c.codexId === selectedChar)?.name || "角色"}
      />
    </div>
  );
}

// ---- 子组件 ----

function Header({
  title,
  onCollapse,
  onBack,
}: {
  title: string;
  onCollapse?: () => void;
  onBack?: () => void;
}) {
  return (
    <div style={S.header}>
      {onBack && (
        <button style={S.headerBtn} onClick={onBack} title="返回选角">
          ←
        </button>
      )}
      <span style={S.headerTitle}>{title}</span>
      <span style={{ flex: 1 }} />
      {onCollapse && (
        <button style={S.headerBtn} onClick={onCollapse} title="收起">
          ✕
        </button>
      )}
    </div>
  );
}

function CharacterSelect({
  characters,
  onSelect,
}: {
  characters: { codexId: string; name: string; summary: string }[];
  onSelect: (id: string) => void;
}) {
  if (characters.length === 0) {
    return (
      <div style={S.emptyState}>
        <p>当前作品没有可对话的角色。</p>
        <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
          请先在信息库中添加「人物」类型的设定条目（含概要）。
        </p>
      </div>
    );
  }
  return (
    <div style={S.charGrid}>
      {characters.map((c) => (
        <button
          key={c.codexId}
          style={S.charCard}
          onClick={() => onSelect(c.codexId)}
        >
          <strong style={S.charName}>{c.name}</strong>
          <span style={S.charSummary}>
            {c.summary.length > 60 ? c.summary.slice(0, 60) + "…" : c.summary}
          </span>
        </button>
      ))}
    </div>
  );
}

function ChatPanel({
  config,
  projectId,
  characterId,
  characterName,
}: {
  config: ApiConfig;
  projectId: string;
  characterId: string;
  characterName: string;
}) {
  const rp = useRoleplay({
    config,
    projectId,
    characterId,
    apiBase: getApiBase(),
  });
  const { messages, streaming, streamingText, error } = rp;

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText]);

  function submit() {
    if (!input.trim() || streaming) return;
    rp.send(input);
    setInput("");
  }

  return (
    <>
      <div ref={scrollRef} style={S.msgList}>
        {messages.length === 0 && !streaming && (
          <div style={S.emptyState}>
            <p>开始与「{characterName}」对话吧。</p>
            <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
              角色将以第一人称回应，保持性格一致。
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} msg={m} characterName={characterName} />
        ))}
        {streaming && streamingText && (
          <div style={{ ...S.bubble, ...S.bubbleChar }}>
            <div style={S.bubbleName}>{characterName}</div>
            <div style={S.bubbleContent}>{streamingText}</div>
          </div>
        )}
        {error && <div style={S.errorBanner}>{error}</div>}
      </div>

      <div style={S.composer}>
        <textarea
          style={S.textarea}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={streaming ? "角色回复中…" : "说点什么…"}
          disabled={streaming}
        />
        <div style={S.btnGroup}>
          {streaming ? (
            <button className="btn btn--ghost btn--sm" onClick={rp.stop}>
              停止
            </button>
          ) : (
            <button className="btn btn--primary btn--sm" onClick={submit} disabled={!input.trim()}>
              发送
            </button>
          )}
          <button className="btn btn--ghost btn--sm" onClick={rp.reset} title="清空对话">
            清空
          </button>
        </div>
      </div>
    </>
  );
}

function MessageBubble({
  msg,
  characterName,
}: {
  msg: RoleplayMessage;
  characterName: string;
}) {
  const isUser = msg.role === "user";
  return (
    <div style={{ ...S.bubble, ...(isUser ? S.bubbleUser : S.bubbleChar) }}>
      <div style={S.bubbleName}>{isUser ? "你" : characterName}</div>
      <div style={S.bubbleContent}>{msg.content}</div>
    </div>
  );
}

// ---- 样式 ----

const S: Record<string, React.CSSProperties> = {
  outer: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: "var(--paper)",
    borderRadius: 12,
    border: "1px solid var(--line)",
    overflow: "hidden",
  },
  flush: {
    borderRadius: 0,
    border: "none",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderBottom: "1px solid var(--line)",
    background: "var(--ink-900)",
  },
  headerTitle: {
    fontFamily: "var(--font-serif)",
    fontSize: 15,
    fontWeight: 600,
    color: "var(--fg)",
  },
  headerBtn: {
    background: "none",
    border: "none",
    color: "var(--fg-dim)",
    cursor: "pointer",
    fontSize: 16,
    padding: "2px 6px",
    borderRadius: 4,
  },
  charGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 8,
    padding: 14,
    overflowY: "auto",
    flex: 1,
  },
  charCard: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--line-strong)",
    background: "var(--ink-800)",
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 0.15s",
  },
  charName: {
    fontSize: 14,
    fontFamily: "var(--font-serif)",
    color: "var(--fg)",
  },
  charSummary: {
    fontSize: 12,
    color: "var(--fg-dim)",
    lineHeight: 1.4,
  },
  emptyState: {
    padding: "32px 16px",
    textAlign: "center",
    color: "var(--fg-dim)",
    fontSize: 14,
  },
  msgList: {
    flex: 1,
    overflowY: "auto",
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  bubble: {
    maxWidth: "85%",
    padding: "8px 12px",
    borderRadius: 10,
    fontSize: 14,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
  },
  bubbleUser: {
    alignSelf: "flex-end",
    background: "rgba(197,106,63,0.12)",
    borderBottomRightRadius: 2,
  },
  bubbleChar: {
    alignSelf: "flex-start",
    background: "var(--ink-800)",
    border: "1px solid var(--line)",
    borderBottomLeftRadius: 2,
  },
  bubbleName: {
    fontSize: 11,
    fontWeight: 600,
    color: "var(--fg-faint)",
    marginBottom: 2,
  },
  bubbleContent: {
    color: "var(--fg)",
  },
  errorBanner: {
    padding: "8px 12px",
    borderRadius: 6,
    background: "rgba(220,60,60,0.1)",
    color: "#d44",
    fontSize: 13,
    textAlign: "center",
  },
  composer: {
    display: "flex",
    gap: 8,
    padding: "10px 14px",
    borderTop: "1px solid var(--line)",
    background: "var(--ink-900)",
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: "1px solid var(--line-strong)",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 14,
    fontFamily: "inherit",
    background: "var(--ink-800)",
    color: "var(--fg)",
    outline: "none",
  },
  btnGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
};

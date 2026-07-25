"use client";

// RoleplayChat —— 沉浸式角色对话面板。
// 支持 1v1 对话和多角色轮转对话。
// 视觉上与 AgentChat 风格一致（暖阁暖色调），但更简洁（无工具/提案面板）。

import { useEffect, useRef, useState } from "react";
import type { ApiConfig, CodexEntry } from "@/lib/types";
import { loadConfig, getApiBase } from "@/lib/client";
import { useRoleplay } from "@/lib/roleplay/useRoleplay";
import type { RoleplayCharacterCard, RoleplayMessage, TurnMode } from "@/lib/roleplay/types";

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
  // 多角色选择支持：selectedChars 为选中角色 codexId 数组
  const [selectedChars, setSelectedChars] = useState<string[]>([]);
  const [characters, setCharacters] = useState<CharInfo[]>(externalChars || []);
  const [loading, setLoading] = useState(!externalChars);
  const [turnMode, setTurnMode] = useState<TurnMode>("round-robin");

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
  if (selectedChars.length === 0) {
    return (
      <div style={{ ...S.outer, ...(flush ? S.flush : {}) }}>
        <Header onCollapse={onCollapse} title="角色对话" />
        {loading ? (
          <div style={S.emptyState}>加载角色列表…</div>
        ) : (
          <CharacterSelect
            characters={characters}
            turnMode={turnMode}
            onTurnModeChange={setTurnMode}
            onConfirm={(ids) => setSelectedChars(ids)}
          />
        )}
      </div>
    );
  }

  // 构建 participants 列表
  const participants: RoleplayCharacterCard[] = selectedChars.map((id) => {
    const c = characters.find((ch) => ch.codexId === id);
    return { codexId: id, name: c?.name || "角色", aliases: [], summary: c?.summary || "", persona: c?.summary || "" };
  });

  const isMulti = selectedChars.length > 1;
  const primaryCharId = selectedChars[0];
  const headerTitle = isMulti
    ? `多角色对话 (${selectedChars.length}人)`
    : characters.find((c) => c.codexId === primaryCharId)?.name || "对话中";

  return (
    <div style={{ ...S.outer, ...(flush ? S.flush : {}) }}>
      <Header
        onCollapse={onCollapse}
        title={headerTitle}
        onBack={() => setSelectedChars([])}
      />
      {/* 多角色顶部参与者标签 */}
      {isMulti && (
        <div style={S.participantsBar}>
          {participants.map((p) => (
            <span key={p.codexId} style={S.participantTag}>{p.name}</span>
          ))}
          <span style={S.turnModeTag}>{turnMode === "round-robin" ? "轮转" : turnMode === "manual" ? "手动" : "旁白"}</span>
        </div>
      )}
      <ChatPanel
        config={resolvedConfig}
        projectId={projectId}
        characterId={primaryCharId}
        characters={characters}
        participants={isMulti ? participants : undefined}
        turnMode={isMulti ? turnMode : undefined}
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
  turnMode,
  onTurnModeChange,
  onConfirm,
}: {
  characters: { codexId: string; name: string; summary: string }[];
  turnMode: TurnMode;
  onTurnModeChange: (mode: TurnMode) => void;
  onConfirm: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

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
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>
      <div style={{ padding: "8px 14px", fontSize: 12, color: "var(--fg-dim)", borderBottom: "1px solid var(--line)" }}>
        点击选择角色（可多选），然后点击「开始对话」
      </div>
      <div style={S.charGrid}>
        {characters.map((c) => {
          const active = selected.includes(c.codexId);
          return (
            <button
              key={c.codexId}
              style={{
                ...S.charCard,
                borderColor: active ? "var(--accent, #c56a3f)" : undefined,
                background: active ? "rgba(197,106,63,0.08)" : S.charCard.background,
              }}
              onClick={() => toggle(c.codexId)}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{
                  width: 16, height: 16, borderRadius: 4, border: "1.5px solid var(--line-strong)",
                  display: "inline-flex", alignItems: "center", justifyContent: "center",
                  background: active ? "var(--accent, #c56a3f)" : "transparent",
                  color: "#fff", fontSize: 11,
                }}>{active ? "✓" : ""}</span>
                <strong style={S.charName}>{c.name}</strong>
              </div>
              <span style={S.charSummary}>
                {c.summary.length > 60 ? c.summary.slice(0, 60) + "…" : c.summary}
              </span>
            </button>
          );
        })}
      </div>
      {/* 多角色时显示轮转模式选择 */}
      {selected.length > 1 && (
        <div style={{ padding: "6px 14px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--fg-dim)" }}>
          <span>模式：</span>
          {(["round-robin", "manual", "narrator-driven"] as TurnMode[]).map((m) => (
            <button
              key={m}
              style={{
                padding: "2px 8px", borderRadius: 4, border: "1px solid var(--line-strong)",
                background: turnMode === m ? "var(--accent, #c56a3f)" : "transparent",
                color: turnMode === m ? "#fff" : "var(--fg-dim)",
                cursor: "pointer", fontSize: 11,
              }}
              onClick={() => onTurnModeChange(m)}
            >
              {m === "round-robin" ? "轮转" : m === "manual" ? "手动" : "旁白驱动"}
            </button>
          ))}
        </div>
      )}
      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--line)" }}>
        <button
          className="btn btn--primary btn--sm"
          style={{ width: "100%" }}
          disabled={selected.length === 0}
          onClick={() => onConfirm(selected)}
        >
          开始对话{selected.length > 0 ? ` (${selected.length}人)` : ""}
        </button>
      </div>
    </div>
  );
}

function ChatPanel({
  config,
  projectId,
  characterId,
  characters,
  participants,
  turnMode,
}: {
  config: ApiConfig;
  projectId: string;
  characterId: string;
  characters: CharInfo[];
  participants?: RoleplayCharacterCard[];
  turnMode?: TurnMode;
}) {
  const isMulti = !!participants && participants.length > 1;
  const rp = useRoleplay({
    config,
    projectId,
    characterId,
    apiBase: getApiBase(),
    participants,
    turnMode,
  });
  const { messages, streaming, streamingText, error, nextSpeaker } = rp;

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 获取角色名 helper
  function getCharName(charId?: string): string {
    if (!charId) return "角色";
    const c = characters.find((ch) => ch.codexId === charId);
    return c?.name || "角色";
  }

  const primaryCharName = getCharName(characterId);

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
            <p>开始与{isMulti ? "角色们" : `「${primaryCharName}」`}对话吧。</p>
            <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
              {isMulti ? "多角色将按轮转模式依次回应。" : "角色将以第一人称回应，保持性格一致。"}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            characterName={getCharName(m.characterId)}
            isMulti={isMulti}
          />
        ))}
        {streaming && streamingText && (
          <div style={{ ...S.bubble, ...S.bubbleChar }}>
            <div style={S.bubbleName}>{nextSpeaker || primaryCharName}</div>
            <div style={S.bubbleContent}>{streamingText}</div>
          </div>
        )}
        {error && <div style={S.errorBanner}>{error}</div>}
      </div>

      <div style={S.composer}>
        {/* 多角色 manual 模式：发言者指示器 */}
        {isMulti && turnMode === "manual" && participants && (
          <div style={S.speakerIndicator}>
            <span style={{ fontSize: 11, color: "var(--fg-dim)" }}>下一位：</span>
            {participants.map((p) => (
              <button
                key={p.codexId}
                style={{
                  ...S.speakerBtn,
                  background: (nextSpeaker === p.name || (!nextSpeaker && p.codexId === characterId))
                    ? "var(--accent, #c56a3f)" : "transparent",
                  color: (nextSpeaker === p.name || (!nextSpeaker && p.codexId === characterId))
                    ? "#fff" : "var(--fg-dim)",
                }}
                onClick={() => rp.setNextSpeaker(p.codexId)}
                title={`指定 ${p.name} 下一个发言`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )}
        {/* 非 manual 模式但多角色时，显示下一位提示 */}
        {isMulti && turnMode !== "manual" && nextSpeaker && (
          <div style={{ fontSize: 11, color: "var(--fg-dim)", padding: "0 0 4px" }}>
            下一位发言：{nextSpeaker}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, alignItems: "flex-end", width: "100%" }}>
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
      </div>
    </>
  );
}

function MessageBubble({
  msg,
  characterName,
  isMulti,
}: {
  msg: RoleplayMessage;
  characterName: string;
  isMulti: boolean;
}) {
  const isUser = msg.role === "user";
  return (
    <div style={{ ...S.bubble, ...(isUser ? S.bubbleUser : S.bubbleChar) }}>
      <div style={S.bubbleName}>
        {isUser ? "你" : characterName}
        {!isUser && isMulti && (
          <span style={S.charTag}>{characterName.slice(0, 1)}</span>
        )}
      </div>
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
    flexDirection: "column",
    gap: 4,
    padding: "10px 14px",
    borderTop: "1px solid var(--line)",
    background: "var(--ink-900)",
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
  // 多角色扩展样式
  participantsBar: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 14px",
    borderBottom: "1px solid var(--line)",
    background: "var(--ink-900)",
    flexWrap: "wrap",
  },
  participantTag: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: 11,
    background: "rgba(197,106,63,0.12)",
    color: "var(--fg)",
    fontWeight: 500,
  },
  turnModeTag: {
    display: "inline-block",
    padding: "2px 8px",
    borderRadius: 10,
    fontSize: 10,
    background: "var(--ink-800)",
    color: "var(--fg-dim)",
    marginLeft: "auto",
  },
  speakerIndicator: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    flexWrap: "wrap",
    paddingBottom: 4,
  },
  speakerBtn: {
    padding: "2px 8px",
    borderRadius: 4,
    border: "1px solid var(--line-strong)",
    cursor: "pointer",
    fontSize: 11,
  },
  charTag: {
    display: "inline-block",
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "var(--accent, #c56a3f)",
    color: "#fff",
    fontSize: 9,
    textAlign: "center",
    lineHeight: "16px",
    marginLeft: 4,
    verticalAlign: "middle",
  },
};

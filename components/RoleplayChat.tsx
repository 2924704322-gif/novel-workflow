"use client";

// RoleplayChat —— 中栏沉浸式酒馆对话面板（FT-21）。
//
// 由「酒馆AI」页（#page-tavern）的「在酒馆里聊聊」或 startRoleplay 唤起，挂载在中栏。
// 支持两种对话目标：
//   - 单角色卡（1v1）：target.kind="character" → useRoleplay 走 /api/agent/roleplay
//   - 单群组（多角色轮转）：target.kind="group" → useRoleplay 带 groupId，API 走 runGroupTurn
//
// 视觉统一清爽风（FT-01 令牌）：--surface / --border / --fg* / --accent / --bg，
// 不再使用旧暖阁令牌（--ink-900 / --ink-800 / --paper / #c56a3f）。

import { useEffect, useRef, useState } from "react";
import type { ApiConfig } from "@/lib/types";
import { loadConfig, getApiBase } from "@/lib/client";
import {
  useRoleplay,
  type UseRoleplayOptions,
} from "@/lib/roleplay/useRoleplay";
import type {
  RoleplayMessage,
} from "@/lib/roleplay/types";
import type { RoleplayGroup } from "@/lib/tavern/types";
import type { RoleplayTarget } from "./studio/StudioProvider";

/** 角色卡列表元数据（GET /api/tavern/characters 返回 CardMeta[]）。 */
interface CharMeta {
  codexId: string;
  name: string;
  updatedAt: number;
}

export interface RoleplayChatProps {
  projectId: string;
  config?: ApiConfig;
  /** 当前对话目标；null = picker 态（用户尚未选角色/群组）。 */
  target: RoleplayTarget | null;
  /** 退出沉浸式酒馆对话，回到中栏创作工作台（ChatStudio）。 */
  onExit?: () => void;
}

export default function RoleplayChat({
  projectId,
  config,
  target,
  onExit,
}: RoleplayChatProps) {
  const [resolvedConfig] = useState<ApiConfig>(() => config ?? loadConfig());
  // 当前选中的对话目标；初始取 prop.target（picker 态时为 null）。
  const [selected, setSelected] = useState<RoleplayTarget | null>(target);
  const [characters, setCharacters] = useState<CharMeta[]>([]);
  const [groups, setGroups] = useState<RoleplayGroup[]>([]);
  const [loading, setLoading] = useState(true);

  // 加载可用角色卡与群组（供 picker 选择）。
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [charRes, grpRes] = await Promise.all([
          fetch(`${getApiBase()}/api/tavern/characters`),
          fetch(
            `${getApiBase()}/api/tavern/groups?projectId=${encodeURIComponent(
              projectId
            )}`
          ),
        ]);
        if (cancelled) return;
        setCharacters(
          charRes.ok ? ((await charRes.json()) as CharMeta[]) : []
        );
        setGroups(grpRes.ok ? ((await grpRes.json()) as RoleplayGroup[]) : []);
      } catch {
        // 网络/解析失败：picker 显示空态，不阻塞。
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // picker 态：展示角色卡 / 群组选择。
  if (!selected) {
    return (
      <div style={S.outer}>
        <Header onExit={onExit} title="选择对话对象" />
        {loading ? (
          <div style={S.emptyState}>加载角色与群组…</div>
        ) : (
          <Picker
            characters={characters}
            groups={groups}
            onPick={(t) => setSelected(t)}
          />
        )}
      </div>
    );
  }

  // chat 态：选中的目标已确定，挂载对话面板。
  const isGroup = selected.kind === "group";
  const group = isGroup
    ? groups.find((g) => g.id === selected.groupId)
    : undefined;
  // 群组模式需要一个字符 codexId 作兜底（runGroupTurn 实际按 members 轮转）。
  const primaryCharId = isGroup
    ? group?.members[0] ?? ""
    : selected.codexId;
  const headerTitle = isGroup
    ? group?.name ?? "群组对话"
    : characters.find((c) => c.codexId === selected.codexId)?.name ?? "对话中";

  return (
    <div style={S.outer}>
      <Header
        onExit={onExit}
        title={headerTitle}
        onBack={() => setSelected(null)}
      />
      <ChatPanel
        config={resolvedConfig}
        projectId={projectId}
        target={selected}
        characterId={primaryCharId}
        characters={characters}
        isGroup={isGroup}
      />
    </div>
  );
}

// ---- 子组件 ----

function Header({
  title,
  onExit,
  onBack,
}: {
  title: string;
  onExit?: () => void;
  onBack?: () => void;
}) {
  return (
    <div style={S.header}>
      {onBack && (
        <button style={S.headerBtn} onClick={onBack} title="返回选择">
          ←
        </button>
      )}
      <span style={S.headerTitle}>{title}</span>
      <span style={{ flex: 1 }} />
      {onExit && (
        <button style={S.headerBtn} onClick={onExit} title="退出酒馆对话">
          ✕
        </button>
      )}
    </div>
  );
}

/** 角色卡 / 群组 单选 picker。 */
function Picker({
  characters,
  groups,
  onPick,
}: {
  characters: CharMeta[];
  groups: RoleplayGroup[];
  onPick: (t: RoleplayTarget) => void;
}) {
  const [kind, setKind] = useState<"character" | "group">("character");
  const [pickedChar, setPickedChar] = useState<string | null>(null);
  const [pickedGroup, setPickedGroup] = useState<string | null>(null);

  const list = kind === "character" ? characters : groups;
  const pickedId = kind === "character" ? pickedChar : pickedGroup;
  const setPicked = kind === "character" ? setPickedChar : setPickedGroup;

  function confirm() {
    if (!pickedId) return;
    onPick(
      kind === "character"
        ? { kind: "character", codexId: pickedId }
        : { kind: "group", groupId: pickedId }
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      {/* 角色 / 群组 分段切换 */}
      <div style={S.seg}>
        <button
          type="button"
          style={{ ...S.segBtn, ...(kind === "character" ? S.segBtnOn : {}) }}
          onClick={() => {
            setKind("character");
            setPickedGroup(null);
          }}
        >
          角色卡
        </button>
        <button
          type="button"
          style={{ ...S.segBtn, ...(kind === "group" ? S.segBtnOn : {}) }}
          onClick={() => {
            setKind("group");
            setPickedChar(null);
          }}
        >
          群组
        </button>
      </div>

      <div style={S.pickerBody}>
        {list.length === 0 ? (
          <div style={S.emptyState}>
            <p>
              {kind === "character"
                ? "当前还没有可用的角色卡。"
                : "当前作品下还没有可用的群组。"}
            </p>
            <p style={{ fontSize: 12, color: "var(--fg-faint)" }}>
              {kind === "character"
                ? "请先在「酒馆配置台」导入或创建角色卡。"
                : "群组管理器将在 FT-22 提供，可在此前手动准备数据。"}
            </p>
          </div>
        ) : (
          <div style={S.charGrid}>
            {kind === "character"
              ? characters.map((c) => {
                  const active = pickedId === c.codexId;
                  return (
                    <button
                      key={c.codexId}
                      type="button"
                      style={{
                        ...S.charCard,
                        borderColor: active ? "var(--accent)" : undefined,
                        background: active ? "var(--accent-soft)" : S.charCard.background,
                      }}
                      onClick={() => setPicked(c.codexId)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={S.checkBox}>{active ? "✓" : ""}</span>
                        <strong style={S.charName}>{c.name}</strong>
                      </div>
                      <span style={S.charSummary}>角色卡</span>
                    </button>
                  );
                })
              : groups.map((g) => {
                  const active = pickedId === g.id;
                  return (
                    <button
                      key={g.id}
                      type="button"
                      style={{
                        ...S.charCard,
                        borderColor: active ? "var(--accent)" : undefined,
                        background: active ? "var(--accent-soft)" : S.charCard.background,
                      }}
                      onClick={() => setPicked(g.id)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <span style={S.checkBox}>{active ? "✓" : ""}</span>
                        <strong style={S.charName}>{g.name}</strong>
                      </div>
                      <span style={S.charSummary}>{`${g.members.length} 位成员`}</span>
                    </button>
                  );
                })}
          </div>
        )}
      </div>

      <div style={{ padding: "10px 14px", borderTop: "1px solid var(--border)" }}>
        <button
          className="btn btn--primary btn--sm"
          style={{ width: "100%" }}
          disabled={!pickedId}
          onClick={confirm}
        >
          开始对话
        </button>
      </div>
    </div>
  );
}

function ChatPanel({
  config,
  projectId,
  target,
  characterId,
  characters,
  isGroup,
}: {
  config: ApiConfig;
  projectId: string;
  target: RoleplayTarget;
  characterId: string;
  characters: CharMeta[];
  isGroup: boolean;
}) {
  // 构建 useRoleplay 入参：群组模式带 groupId + list/swap（FT-19/FT-20）。
  const rpOptions: UseRoleplayOptions = isGroup
    ? {
        config,
        projectId,
        characterId,
        apiBase: getApiBase(),
        groupId: target.kind === "group" ? target.groupId : "",
        activationStrategy: "list",
        generationMode: "swap",
      }
    : {
        config,
        projectId,
        characterId,
        apiBase: getApiBase(),
      };

  const rp = useRoleplay(rpOptions);
  const { messages, streaming, streamingText, error, nextSpeaker } = rp;

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 角色名解析：优先用角色卡列表；群组消息的 characterId 为成员 codexId。
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
            <p>
              开始与{isGroup ? "群组" : `「${primaryCharName}」`}对话吧。
            </p>
            <p style={{ fontSize: 12, color: "var(--fg-dim)" }}>
              {isGroup
                ? "群组成员将按 List 策略依次回应。"
                : "角色将以第一人称回应，保持性格一致。"}
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            msg={m}
            characterName={getCharName(m.characterId)}
            isMulti={isGroup}
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
        {isGroup && nextSpeaker && (
          <div
            style={{ fontSize: 11, color: "var(--fg-dim)", padding: "0 0 4px" }}
          >
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
            placeholder={streaming ? "回复中…" : "说点什么…"}
            disabled={streaming}
          />
          <div style={S.btnGroup}>
            {streaming ? (
              <button className="btn btn--ghost btn--sm" onClick={rp.stop}>
                停止
              </button>
            ) : (
              <button
                className="btn btn--primary btn--sm"
                onClick={submit}
                disabled={!input.trim()}
              >
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

// ---- 样式（清爽风令牌）----

const S: Record<string, React.CSSProperties> = {
  outer: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    minHeight: 0,
    background: "var(--surface)",
    borderRadius: "var(--radius)",
    border: "1px solid var(--border)",
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    background: "var(--surface-2)",
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
  seg: {
    display: "flex",
    gap: 4,
    padding: "8px 14px",
    background: "var(--surface-2)",
    borderBottom: "1px solid var(--border)",
  },
  segBtn: {
    flex: 1,
    padding: "6px 0",
    fontSize: 13,
    borderRadius: "var(--radius-pill)",
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--fg-dim)",
    cursor: "pointer",
  },
  segBtnOn: {
    background: "var(--surface)",
    color: "var(--fg)",
    borderColor: "var(--accent)",
    fontWeight: 600,
  },
  pickerBody: {
    flex: 1,
    minHeight: 0,
    overflowY: "auto",
  },
  charGrid: {
    display: "grid",
    gridTemplateColumns: "1fr",
    gap: 8,
    padding: 14,
  },
  charCard: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "12px 14px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid var(--border-strong)",
    background: "var(--surface-2)",
    cursor: "pointer",
    textAlign: "left",
    transition: "border-color 0.15s",
  },
  checkBox: {
    width: 16,
    height: 16,
    borderRadius: 4,
    border: "1.5px solid var(--border-strong)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 11,
    flex: "0 0 auto",
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
    minHeight: 0,
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
    background: "var(--accent-soft)",
    borderBottomRightRadius: 2,
  },
  bubbleChar: {
    alignSelf: "flex-start",
    background: "var(--surface-2)",
    border: "1px solid var(--border)",
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
    background: "rgba(229,72,77,0.1)",
    color: "var(--danger)",
    fontSize: 13,
    textAlign: "center",
  },
  composer: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    background: "var(--surface-2)",
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: "1px solid var(--border-strong)",
    borderRadius: 8,
    padding: "8px 10px",
    fontSize: 14,
    fontFamily: "inherit",
    background: "var(--surface)",
    color: "var(--fg)",
    outline: "none",
  },
  btnGroup: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  charTag: {
    display: "inline-block",
    width: 16,
    height: 16,
    borderRadius: "50%",
    background: "var(--accent)",
    color: "#fff",
    fontSize: 9,
    textAlign: "center",
    lineHeight: "16px",
    marginLeft: 4,
    verticalAlign: "middle",
  },
};

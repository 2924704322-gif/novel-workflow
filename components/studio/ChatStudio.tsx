"use client";

// 中栏 AI 对话系统（FT-05 / Q6：纯 AI 对话，承接大纲/正文/角色对话能力）
//
// 结构：CreateBar（快速创作） + 消息流（气泡 + 流式光标槽位 + 工具活动）
//       + Composer（输入器） + PlusPanel（「+」展开器） + InDialogModal（对话内模态）
//       + HitlMdCard（带 md 的 HITL 提案卡）。
//
// 复用 lib/agent/useChat（不重写运行时）：将实例通过 StudioProvider.setChat 注册，
// 供 TopBar「新对话」调用；对话上下文（projectId）取自 StudioProvider.selectedBookId。

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useStudio } from "./StudioProvider";
import { useChat, type UseChat } from "@/lib/agent/useChat";
import { loadConfig, hasConfig, getApiBase, fetchProject } from "@/lib/client";
import { mockChatStream, httpChatStream, type ChatTransport } from "@/lib/agent/mockStream";
import type { ApiConfig } from "@/lib/types";
import type { ChangeProposal, ChatMessage } from "@/lib/agent/types";
import CreateBar, { type CreateType } from "./CreateBar";
import Composer from "./Composer";
import PlusPanel from "./PlusPanel";
import InDialogModal, { type ModalKind } from "./InDialogModal";
import HitlMdCard from "./HitlMdCard";

// 快速创作 seed 文案（Q6：中栏 create-bar 四 chip）。
const SEED: Record<CreateType, (book: string) => string> = {
  world: (b) => `生成《${b}》的世界观设定 .md，包含地理、势力、核心法则与核心冲突。`,
  character: (b) => `为《${b}》生成人物设定 .md，给出 3 个核心角色的姓名、身份、动机与弧光。`,
  outline: (b) => `生成《${b}》的分卷大纲 .md，列出各卷主题与关键转折。`,
  chapter: (b) => `为《${b}》生成一章正文的 .md 草稿（先确认目标章节与基调）。`,
};

export default function ChatStudio() {
  const studio = useStudio();
  const { selectedBookId, confirmError } = studio;

  // seed 文案用真实书名（此前误用项目 id 当书名）；未取到前回落「本书」。
  const [bookTitle, setBookTitle] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedBookId) {
      setBookTitle(null);
      return;
    }
    let alive = true;
    fetchProject(selectedBookId).then((p) => {
      if (alive) setBookTitle(p?.title ?? null);
    });
    return () => {
      alive = false;
    };
  }, [selectedBookId]);
  const bookLabel = bookTitle ?? "本书";

  // 配置与传输层只定一次（P1-1 修复）：已配置 API 走真实 /api/agent/chat
  // （NDJSON，经 apiBase 接缝①，对齐 AgentChat）；未配置回落 mock 流，
  // 保证离线/演示环境仍可完整走 HITL 提案卡闭环。
  const [config] = useState<ApiConfig>(() => loadConfig());
  const [transport] = useState<ChatTransport>(() =>
    hasConfig() ? httpChatStream(getApiBase()) : mockChatStream
  );

  const chat = useChat({ config, transport, projectId: selectedBookId ?? undefined });

  // 把 useChat 实例注册到 StudioProvider（稳定 facade，避免每次渲染触发重注册 / 无限循环）。
  const chatRef = useRef(chat);
  chatRef.current = chat;
  const chatFacade = useMemo<UseChat>(
    () => ({
      messages: [],
      streaming: false,
      streamingText: "",
      toolActivity: [],
      proposals: [],
      error: null,
      activeSkill: null,
      send: (t) => chatRef.current.send(t),
      runSkill: (id, p) => chatRef.current.runSkill(id, p),
      // P2-7：补透传 mdBody（HITL 卡编辑后的正文），与 UseChat.confirm 签名对齐。
      confirm: (id, ok, mdBody) => chatRef.current.confirm(id, ok, mdBody),
      stop: () => chatRef.current.stop(),
      reset: () => chatRef.current.reset(),
    }),
    []
  );
  useEffect(() => {
    studio.setChat(chatFacade);
    return () => studio.setChat(null);
  }, [studio, chatFacade]);

  const { messages, streaming, streamingText, toolActivity, proposals, error, activeSkill } = chat;

  const [input, setInput] = useState("");
  const [plusOpen, setPlusOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [modalKind, setModalKind] = useState<ModalKind | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamingText, toolActivity, proposals]);

  const send = useCallback(() => {
    const text = input.trim();
    if (!text || streaming) return;
    chat.send(text);
    setInput("");
    setPlusOpen(false);
    setSkillsOpen(false);
  }, [input, streaming, chat]);

  const handleCreate = useCallback(
    (type: CreateType) => {
      chat.send(SEED[type](bookLabel));
      setPlusOpen(false);
    },
    [chat, bookLabel]
  );

  const handleSeed = useCallback(
    (text: string) => {
      chat.send(text);
      setPlusOpen(false);
    },
    [chat]
  );

  const handlePickSkill = useCallback(
    (id: string) => {
      chat.runSkill(id, {});
      setSkillsOpen(false);
      setModalKind(null);
    },
    [chat]
  );

  const empty = messages.length === 0 && !streaming && proposals.length === 0;

  return (
    <section className="chat-studio" aria-label="AI 对话">
      <CreateBar onPick={handleCreate} disabled={streaming} />

      <div className="chat" ref={scrollRef} role="log" aria-live="polite">
        {empty && (
          <div className="chat-studio-empty">
            <div className="seal" style={{ width: 44, height: 44, fontSize: 22 }}>
              N
            </div>
            <h2 style={{ fontFamily: "var(--font-serif)", fontSize: 20, margin: "14px 0 6px" }}>
              开始一段对话
            </h2>
            <p className="muted" style={{ fontSize: 14, maxWidth: 360, textAlign: "center", lineHeight: 1.7 }}>
              点上方「世界观 / 人物设定 / 大纲 / 章节」快速创作，或从「+」展开更多能力。
              确认写入的 .md 提案会落到右栏的书详情里。
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <MessageBubble key={i} message={m} />
        ))}

        {/* 流式进行中的助手气泡（架构不变量：气泡 + 工具活动 + 流式光标槽位必留） */}
        {streaming && (streamingText || toolActivity.length > 0) && (
          <div className="msg ai">
            <div className="bubble">
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
                  <span className="chat-caret" />
                </span>
              )}
            </div>
          </div>
        )}

        {/* 纯思考态 */}
        {streaming && !streamingText && toolActivity.length === 0 && (
          <div className="msg ai">
            <div className="bubble">
              <span className="muted">思考中…</span>
            </div>
          </div>
        )}

        {/* 待确认提案：带 md 的渲染 HitlMdCard，其余渲染通用提案卡 */}
        {proposals.map((p) =>
          p.md ? (
            <HitlMdCard
              key={p.id}
              proposal={p}
              disabled={streaming}
              onConfirm={(body) => {
                chat.confirm(p.id, true, body);
                // FT-09：确认写入闭环——把可编辑 .md 提案交给 StudioProvider 落稿（章节→阅读 / 设定→文档）。
                if (p.md) studio.confirmMd(p.md);
              }}
              onCancel={() => chat.confirm(p.id, false)}
              onRegenerate={() => chat.send("请重新生成上面这份提案，保持文件名与类型不变")}
            />
          ) : (
            <ProposalCard
              key={p.id}
              proposal={p}
              disabled={streaming}
              onConfirm={() => chat.confirm(p.id, true)}
              onCancel={() => chat.confirm(p.id, false)}
            />
          )
        )}

        {error && (
          <div className="chat-error">
            <span className="dot dot--draft" /> {error}
          </div>
        )}

        {/* P2-8：confirmMd 落稿失败的用户可见错误条（此前只打 console） */}
        {confirmError && (
          <div className="chat-error">
            <span className="dot dot--draft" /> 落稿失败：{confirmError}
          </div>
        )}
      </div>

      <div className="composer-wrap">
        <Composer
          value={input}
          onChange={setInput}
          onSend={send}
          onTogglePlus={() => setPlusOpen((v) => !v)}
          plusOpen={plusOpen}
          onToggleSkills={() => setSkillsOpen((v) => !v)}
          skillsOpen={skillsOpen}
          onPickSkill={handlePickSkill}
          streaming={streaming}
          onStop={chat.stop}
          activeSkill={activeSkill}
        />
        {plusOpen && (
          <PlusPanel
            onSeed={handleSeed}
            onOpenModal={(k) => {
              setModalKind(k);
              setPlusOpen(false);
            }}
            onClose={() => setPlusOpen(false)}
          />
        )}
      </div>

      {modalKind && (
        <InDialogModal kind={modalKind} onClose={() => setModalKind(null)} onPickSkill={handlePickSkill} />
      )}
    </section>
  );
}

// ---- 局部展示组件（气泡 / 工具 chip / 通用提案卡） ----

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="bubble">{message.content}</div>
      </div>
    );
  }
  return (
    <div className="msg ai">
      <div className="bubble">
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
    <span className="tool-chip">
      <span className="tool-dot" style={{ background: done ? "var(--jade)" : "var(--amber)" }} />
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
  return (
    <div className="hitl">
      <div className="hitl-head">
        <span className="chip chip--cinnabar">待确认改动</span>
        <span className="muted" style={{ fontSize: 12 }}>
          {proposal.tool}
        </span>
      </div>
      <div className="hitl-body">
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>
          {proposal.changeSummary}
        </p>
        <div className="hitl-actions">
          <button className="btn-primary" onClick={onConfirm} disabled={disabled}>
            确认写入
          </button>
          <button className="btn-ghost" onClick={onCancel} disabled={disabled}>
            取消
          </button>
        </div>
      </div>
    </div>
  );
}

"use client";

// useRoleplay —— 角色对话客户端状态机。
// 消费 /api/agent/roleplay 的 NDJSON 流（RoleplayStreamEvent），
// 管理多轮消息、流式文本增量、错误状态。

import { useCallback, useRef, useState } from "react";
import type { ApiConfig } from "../types";
import type { RoleplayCharacterCard, RoleplayMessage, RoleplayRequest, RoleplayStreamEvent, TurnMode } from "./types";

/** 群组激活策略（对齐 RoleplayGroup.activationStrategy，FT-19/FT-20）。 */
export type ActivationStrategy = "manual" | "list" | "natural" | "pooled";

/** 群组生成模式（swap=替换上一轮 / append=追加到上下文，FT-19/FT-20）。 */
export type GenerationMode = "swap" | "append";

export interface UseRoleplayOptions {
  config: ApiConfig;
  projectId: string;
  characterId: string;
  apiBase?: string;              // 默认空（相对路径）
  initialMessages?: RoleplayMessage[];
  sessionId?: string;
  // 多角色扩展
  participants?: RoleplayCharacterCard[];
  turnMode?: TurnMode;
  // —— 酒馆AI 群组 / lorebook 扩展（FT-18/FT-19/FT-20，向后兼容，全可选）——
  /** 走群组范式（RoleplayGroup.id）；存在时 API 路由到 runGroupTurn。 */
  groupId?: string;
  /** 显式指定额外 lorebook（覆盖角色私有书）。 */
  lorebookIds?: string[];
  /** lorebook 扫描深度（覆盖默认 20）。 */
  scanDepth?: number;
  /** lorebook token 预算（覆盖默认 1024）。 */
  tokenBudget?: number;
  /** 群组激活策略（manual 时前端指定）。 */
  activationStrategy?: ActivationStrategy;
  /** 群组生成模式（swap | append）。 */
  generationMode?: GenerationMode;
  /** 群组/请求级 scenario 覆盖。 */
  scenarioOverride?: string;
}

export interface UseRoleplay {
  messages: RoleplayMessage[];
  streaming: boolean;
  streamingText: string;
  error: string | null;
  sessionId: string | null;
  nextSpeaker: string | null;      // 多角色：下一位发言者名称
  send: (text: string) => void;
  stop: () => void;
  reset: () => void;
  setNextSpeaker: (codexId: string) => void;  // manual 模式下指定发言者
}

function generateMsgId(): string {
  return `msg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

export function useRoleplay(opts: UseRoleplayOptions): UseRoleplay {
  const {
    config,
    projectId,
    characterId,
    apiBase = "",
    initialMessages = [],
    sessionId: initSessionId,
    participants,
    turnMode,
    groupId,
    lorebookIds,
    scanDepth,
    tokenBudget,
    activationStrategy,
    generationMode,
    scenarioOverride,
  } = opts;

  const [messages, setMessages] = useState<RoleplayMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(initSessionId || null);
  const [nextSpeaker, setNextSpeakerState] = useState<string | null>(null);
  const targetCharRef = useRef<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  const runTurn = useCallback(
    async (history: RoleplayMessage[]) => {
      setError(null);
      setStreaming(true);
      setStreamingText("");

      const controller = new AbortController();
      abortRef.current = controller;

      const req: RoleplayRequest = {
        config,
        projectId,
        characterId,
        messages: history,
        sessionId: sessionId || undefined,
        participants,
        turnMode,
        targetCharacterId: targetCharRef.current || undefined,
        // —— 酒馆AI 群组 / lorebook 扩展（仅当显式传入时带上，向后兼容）——
        ...(groupId ? { groupId } : {}),
        ...(lorebookIds && lorebookIds.length > 0 ? { lorebookIds } : {}),
        ...(scanDepth != null ? { scanDepth } : {}),
        ...(tokenBudget != null ? { tokenBudget } : {}),
        ...(activationStrategy ? { activationStrategy } : {}),
        ...(generationMode ? { generationMode } : {}),
        ...(scenarioOverride != null && scenarioOverride !== "" ? { scenarioOverride } : {}),
      };

      let acc = "";

      try {
        const res = await fetch(`${apiBase}/api/agent/roleplay`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(req),
          signal: controller.signal,
        });

        if (!res.ok || !res.body) {
          const msg = await res.text().catch(() => "请求失败");
          setError(msg || `请求失败 (${res.status})`);
          setStreaming(false);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, nl).trim();
            buf = buf.slice(nl + 1);
            if (!line) continue;
            try {
              const ev = JSON.parse(line) as RoleplayStreamEvent;
              switch (ev.type) {
                case "text":
                  acc += ev.delta;
                  setStreamingText(acc);
                  break;
                case "done":
                  if (ev.sessionId) setSessionId(ev.sessionId);
                  if (ev.nextSpeaker) setNextSpeakerState(ev.nextSpeaker);
                  break;
                case "error":
                  setError(ev.message);
                  break;
              }
            } catch { /* skip partial lines */ }
          }
        }
        // trailing
        const tail = buf.trim();
        if (tail) {
          try {
            const ev = JSON.parse(tail) as RoleplayStreamEvent;
            if (ev.type === "text") acc += ev.delta;
            else if (ev.type === "done" && ev.sessionId) setSessionId(ev.sessionId);
            else if (ev.type === "error") setError(ev.message);
          } catch { /* ignore */ }
        }

        // 固化角色回复
        if (acc) {
          const charMsg: RoleplayMessage = {
            id: generateMsgId(),
            role: "character",
            characterId,
            content: acc,
            createdAt: Date.now(),
          };
          setMessages((prev) => [...prev, charMsg]);
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          setError((e as Error)?.message || "对话出错，请稍后重试。");
        }
      } finally {
        setStreaming(false);
        setStreamingText("");
        abortRef.current = null;
      }
    },
    [config, projectId, characterId, apiBase, sessionId, participants, turnMode, groupId, lorebookIds, scanDepth, tokenBudget, activationStrategy, generationMode, scenarioOverride]
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      const userMsg: RoleplayMessage = {
        id: generateMsgId(),
        role: "user",
        content: trimmed,
        createdAt: Date.now(),
      };
      const next = [...messages, userMsg];
      setMessages(next);
      void runTurn(next);
    },
    [messages, runTurn, streaming]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setStreamingText("");
    setError(null);
    setSessionId(null);
    setNextSpeakerState(null);
    targetCharRef.current = null;
  }, []);

  const setNextSpeaker = useCallback((codexId: string) => {
    targetCharRef.current = codexId;
  }, []);

  return {
    messages,
    streaming,
    streamingText,
    error,
    sessionId,
    nextSpeaker,
    send,
    stop,
    reset,
    setNextSpeaker,
  };
}

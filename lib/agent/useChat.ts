"use client";

// useChat —— 对话面板的状态机（Sub B）。
// 负责：维护多轮消息、消费流式 AgentStreamEvent、聚合工具活动、
// 收集待确认的 ChangeProposal，并在用户确认后带 confirmations 发起下一轮。
//
// 传输层可插拔：默认 mockChatStream；联调时传入 httpChatStream(apiBase)。

import { useCallback, useRef, useState } from "react";
import type { ApiConfig } from "../types";
import type {
  AgentChatRequest,
  ChangeProposal,
  ChatMessage,
  ChatToolCall,
  ConfirmToken,
} from "./types";
import { mockChatStream, type ChatTransport } from "./mockStream";

export interface UseChatOptions {
  config: ApiConfig; // 接缝④：模型与密钥仍由客户端携带
  transport?: ChatTransport; // 缺省 mock；联调换 httpChatStream(apiBase)
  projectId?: string; // 当前作品上下文（可空）
  initialMessages?: ChatMessage[];
}

// 一次工具调用在 UI 上的可视轨迹（调用 → 返回）。
export interface ToolActivity {
  name: string;
  args?: unknown;
  result?: unknown;
  done: boolean;
}

export interface UseChat {
  messages: ChatMessage[];
  streaming: boolean;
  streamingText: string;
  toolActivity: ToolActivity[];
  proposals: ChangeProposal[];
  error: string | null;
  activeSkill: string | null; // 当前正在执行的技能名称（null=无）
  send: (text: string) => void;
  runSkill: (skillId: string, skillParams: Record<string, string>) => void;
  confirm: (proposalId: string, approved: boolean) => void;
  stop: () => void;
  reset: () => void;
}

export function useChat(opts: UseChatOptions): UseChat {
  const { config, transport = mockChatStream, projectId, initialMessages = [] } = opts;

  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [toolActivity, setToolActivity] = useState<ToolActivity[]>([]);
  const [proposals, setProposals] = useState<ChangeProposal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [activeSkill, setActiveSkill] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  // 当前轮次的 skill 信息（ref 避免闭包抓旧值）。
  const skillRef = useRef<{ id: string; params: Record<string, string> } | null>(null);

  // 跑一轮：把 history 发给传输层，逐条消费事件，done 时把助手回复固化进 messages。
  const runTurn = useCallback(
    async (history: ChatMessage[], confirmations?: ConfirmToken[]) => {
      setError(null);
      setStreaming(true);
      setStreamingText("");
      setToolActivity([]);

      const controller = new AbortController();
      abortRef.current = controller;

      const req: AgentChatRequest = {
        config,
        messages: history,
        projectId,
        ...(confirmations ? { confirmations } : {}),
        ...(skillRef.current ? { skillId: skillRef.current.id, skillParams: skillRef.current.params } : {}),
      };

      let acc = "";
      const tools: ToolActivity[] = [];

      try {
        for await (const ev of transport(req, { signal: controller.signal })) {
          switch (ev.type) {
            case "text":
              acc += ev.delta;
              setStreamingText(acc);
              break;
            case "tool_call":
              tools.push({ name: ev.name, args: ev.args, done: false });
              setToolActivity([...tools]);
              break;
            case "tool_result": {
              const t = [...tools].reverse().find((x) => x.name === ev.name && !x.done);
              if (t) {
                t.result = ev.result;
                t.done = true;
              } else {
                tools.push({ name: ev.name, result: ev.result, done: true });
              }
              setToolActivity([...tools]);
              break;
            }
            case "proposal":
              setProposals((prev) => [...prev, ev.proposal]);
              break;
            case "error":
              setError(ev.message);
              break;
            case "done":
            default:
              break;
          }
        }

        // 固化本轮助手消息（有文本或有工具活动才落一条）。
        if (acc || tools.length > 0) {
          const toolCalls: ChatToolCall[] = tools.map((t) => ({
            name: t.name,
            args: t.args,
            result: t.result,
          }));
          const assistant: ChatMessage = {
            role: "assistant",
            content: acc,
            ...(toolCalls.length ? { toolCalls } : {}),
          };
          setMessages((prev) => [...prev, assistant]);
        }
      } catch (e) {
        if ((e as Error)?.name !== "AbortError") {
          setError((e as Error)?.message || "对话出错，请稍后重试。");
        }
      } finally {
        setStreaming(false);
        setStreamingText("");
        setToolActivity([]);
        abortRef.current = null;
        // Skill 模式下：轮次结束后清除技能状态（除非有 proposal 待确认）。
        if (skillRef.current) {
          skillRef.current = null;
          setActiveSkill(null);
        }
      }
    },
    [config, projectId, transport]
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || streaming) return;
      const userMsg: ChatMessage = { role: "user", content: trimmed };
      const next = [...messages, userMsg];
      setMessages(next);
      void runTurn(next);
    },
    [messages, runTurn, streaming]
  );

  const runSkill = useCallback(
    (skillId: string, skillParams: Record<string, string>) => {
      if (streaming) return;
      skillRef.current = { id: skillId, params: skillParams };
      setActiveSkill(skillId);
      // 技能首轮：history 为空（让 runtime 的 initialInstruction 自动注入）。
      void runTurn([]);
    },
    [runTurn, streaming]
  );

  const confirm = useCallback(
    (proposalId: string, approved: boolean) => {
      if (streaming) return;
      setProposals((prev) => prev.filter((p) => p.id !== proposalId));
      void runTurn(messages, [{ proposalId, approved }]);
    },
    [messages, runTurn, streaming]
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setMessages([]);
    setProposals([]);
    setStreamingText("");
    setToolActivity([]);
    setError(null);
  }, []);

  return {
    messages,
    streaming,
    streamingText,
    toolActivity,
    proposals,
    error,
    activeSkill,
    send,
    runSkill,
    confirm,
    stop,
    reset,
  };
}

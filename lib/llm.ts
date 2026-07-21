import type { ApiConfig } from "./types";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

function normalizeBaseUrl(baseUrl: string): string {
  let b = baseUrl.trim().replace(/\/+$/, "");
  // allow users to paste either ".../v1" or the bare host
  if (!/\/v\d+$/.test(b) && !b.endsWith("/chat/completions")) {
    b = `${b}/v1`;
  }
  return b;
}

export function validateConfig(cfg: Partial<ApiConfig>): string | null {
  if (!cfg.baseUrl) return "缺少 API 地址（Base URL）";
  if (!cfg.apiKey) return "缺少 API Key";
  if (!cfg.model) return "缺少模型名称";
  return null;
}

/**
 * Calls an OpenAI-compatible /chat/completions endpoint with streaming and
 * returns a ReadableStream<Uint8Array> of the raw generated text (already
 * unwrapped from SSE deltas). Suitable to pipe straight to the browser.
 */
export async function streamChat(
  cfg: ApiConfig,
  messages: ChatMessage[],
  opts?: { maxTokens?: number; signal?: AbortSignal }
): Promise<ReadableStream<Uint8Array>> {
  const base = normalizeBaseUrl(cfg.baseUrl);
  const url = base.endsWith("/chat/completions")
    ? base
    : `${base}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      messages,
      temperature: cfg.temperature ?? 0.8,
      max_tokens: opts?.maxTokens ?? 8192,
      stream: true,
    }),
    signal: opts?.signal,
  });

  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `模型接口返回错误 ${res.status}. ${detail.slice(0, 500)}`
    );
  }

  const upstream = res.body;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      let buffer = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data:")) continue;
            const data = trimmed.slice(5).trim();
            if (data === "[DONE]") continue;
            try {
              const json = JSON.parse(data);
              const delta: string =
                json.choices?.[0]?.delta?.content ??
                json.choices?.[0]?.message?.content ??
                "";
              if (delta) controller.enqueue(encoder.encode(delta));
            } catch {
              // ignore partial/keep-alive frames
            }
          }
        }
      } catch (err) {
        controller.error(err);
        return;
      }
      controller.close();
    },
  });
}

/** Non-streaming helper: collect the full completion into a string. */
export async function completeChat(
  cfg: ApiConfig,
  messages: ChatMessage[],
  opts?: { maxTokens?: number }
): Promise<string> {
  const stream = await streamChat(cfg, messages, opts);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  return out;
}

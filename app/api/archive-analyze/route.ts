import { NextRequest } from "next/server";
import { completeChat, validateConfig } from "@/lib/llm";
import { buildArchiveAnalyzePrompt, extractJson } from "@/lib/prompts";
import type { ApiConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/archive-analyze
// body: { config, text } — analyze ONE text chunk for story-archive material
// (world/characters/plot). The client orchestrates chunking/sampling/merging
// (mirrors /api/style-analyze). Returns the raw snake_case analysis JSON.
export async function POST(req: NextRequest) {
  const { config, text } = (await req.json()) as {
    config: ApiConfig;
    text: string;
  };

  const err = validateConfig(config);
  if (err) return new Response(err, { status: 400 });
  if (!text || !text.trim()) {
    return new Response("文本片段为空", { status: 400 });
  }

  const messages = buildArchiveAnalyzePrompt(text);

  // Two attempts: models occasionally wrap JSON in prose or emit a stray token.
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await completeChat(config, messages, { maxTokens: 3200 });
      const json = extractJson(raw);
      return Response.json(json);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "分析失败";
    }
  }
  return new Response(lastErr || "分析服务暂时不可用", { status: 502 });
}

import { NextRequest } from "next/server";
import { completeChat, validateConfig } from "@/lib/llm";
import { buildArchiveReducePrompt, extractJson } from "@/lib/prompts";
import type { ApiConfig } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/archive-reduce
// body: { config, material } — second-pass synthesis over ALL per-chunk
// analyses. The client compiles `material` (lib/archive.ts buildReduceMaterial)
// from every chunk; this call returns a coherent whole-book synopsis /
// worldbuilding / themes and a CONDENSED main_plot. Returns snake_case JSON.
export async function POST(req: NextRequest) {
  const { config, material } = (await req.json()) as {
    config: ApiConfig;
    material: string;
  };

  const err = validateConfig(config);
  if (err) return new Response(err, { status: 400 });
  if (!material || !material.trim()) {
    return new Response("综合素材为空", { status: 400 });
  }

  const messages = buildArchiveReducePrompt(material);

  // Two attempts: models occasionally wrap JSON in prose or emit a stray token.
  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await completeChat(config, messages, { maxTokens: 2560 });
      const json = extractJson(raw);
      return Response.json(json);
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "综合失败";
    }
  }
  return new Response(lastErr || "综合服务暂时不可用", { status: 502 });
}

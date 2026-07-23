import { NextRequest } from "next/server";
import { streamChat, validateConfig } from "@/lib/llm";
import { buildBiblePrompt } from "@/lib/prompts";
import type { ApiConfig, ProjectSetup } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/generate/bible
// body: { config: ApiConfig, setup: ProjectSetup, direction?: string }
// Streams the raw model text (a JSON document with the story bible only).
export async function POST(req: NextRequest) {
  const { config, setup, direction } = (await req.json()) as {
    config: ApiConfig;
    setup: ProjectSetup;
    direction?: string;
  };

  const err = validateConfig(config);
  if (err) {
    return new Response(err, { status: 400 });
  }

  try {
    const stream = await streamChat(config, buildBiblePrompt(setup, direction), {
      maxTokens: 8192,
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "生成失败";
    return new Response(msg, { status: 502 });
  }
}

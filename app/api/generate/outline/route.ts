import { NextRequest } from "next/server";
import { streamChat, validateConfig } from "@/lib/llm";
import { buildBiblePrompt } from "@/lib/prompts";
import type { ApiConfig, ProjectSetup } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/generate/outline
// body: { config: ApiConfig, setup: ProjectSetup }
// Streams the raw model text (a JSON document with bible + volumes).
export async function POST(req: NextRequest) {
  const { config, setup } = (await req.json()) as {
    config: ApiConfig;
    setup: ProjectSetup;
  };

  const err = validateConfig(config);
  if (err) {
    return new Response(err, { status: 400 });
  }

  try {
    const stream = await streamChat(config, buildBiblePrompt(setup), {
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

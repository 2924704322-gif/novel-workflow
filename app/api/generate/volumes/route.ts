import { NextRequest } from "next/server";
import { streamChat, validateConfig } from "@/lib/llm";
import { buildVolumesPrompt } from "@/lib/prompts";
import { LLM_MAX_TOKENS } from "@/lib/constants";
import type { ApiConfig, ProjectSetup, StoryBible } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/generate/volumes
// body: { config: ApiConfig, setup: ProjectSetup, bible: StoryBible, direction?: string }
// Streams the raw model text (a JSON document with the volume-level outline).
export async function POST(req: NextRequest) {
  const { config, setup, bible, direction } = (await req.json()) as {
    config: ApiConfig;
    setup: ProjectSetup;
    bible: StoryBible;
    direction?: string;
  };

  const err = validateConfig(config);
  if (err) {
    return new Response(err, { status: 400 });
  }

  try {
    const stream = await streamChat(
      config,
      buildVolumesPrompt(setup, bible, direction),
      {
        maxTokens: LLM_MAX_TOKENS,
      }
    );
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

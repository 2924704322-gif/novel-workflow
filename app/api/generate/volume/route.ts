import { NextRequest } from "next/server";
import { streamChat, validateConfig } from "@/lib/llm";
import { buildVolumeChaptersPrompt } from "@/lib/prompts";
import type { ApiConfig, ProjectSetup, StoryBible, Volume } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/generate/volume
// body: { config, setup, bible, volume, chapterCount }
// Streams a JSON document with the volume's chapter synopses.
export async function POST(req: NextRequest) {
  const { config, setup, bible, volume, chapterCount } = (await req.json()) as {
    config: ApiConfig;
    setup: ProjectSetup;
    bible: StoryBible;
    volume: Volume;
    chapterCount: number;
  };

  const err = validateConfig(config);
  if (err) return new Response(err, { status: 400 });

  try {
    const stream = await streamChat(
      config,
      buildVolumeChaptersPrompt(setup, bible, volume, chapterCount),
      { maxTokens: 8192 }
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

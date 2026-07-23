import { NextRequest } from "next/server";
import { streamChat, validateConfig } from "@/lib/llm";
import { buildChapterOutlinePrompt } from "@/lib/prompts";
import type { ApiConfig, ProjectSetup, StoryBible, Volume } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/generate/chapter-outline
// body: { config, setup, bible, volume, mode, targetIndex?, globalStart?, direction? }
// Streams a JSON document describing a single chapter { title, synopsis }.
// mode "regen" rewrites the chapter at targetIndex; mode "next" appends one.
export async function POST(req: NextRequest) {
  const { config, setup, bible, volume, mode, targetIndex, globalStart, direction } =
    (await req.json()) as {
      config: ApiConfig;
      setup: ProjectSetup;
      bible: StoryBible;
      volume: Volume;
      mode: "regen" | "next";
      targetIndex?: number;
      globalStart?: number;
      direction?: string;
    };

  const err = validateConfig(config);
  if (err) return new Response(err, { status: 400 });

  try {
    const stream = await streamChat(
      config,
      buildChapterOutlinePrompt(setup, bible, volume, {
        mode,
        targetIndex,
        globalStart,
        direction,
      }),
      { maxTokens: 2048 }
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

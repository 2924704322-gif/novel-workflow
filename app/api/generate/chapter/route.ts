import { NextRequest } from "next/server";
import { streamChat, validateConfig } from "@/lib/llm";
import { buildChapterPrompt } from "@/lib/prompts";
import { LLM_MAX_TOKENS } from "@/lib/constants";
import type { ChapterContext } from "@/lib/retrieval";
import type {
  ApiConfig,
  Chapter,
  PromptEntry,
  ProjectSetup,
  StoryBible,
  Volume,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 600;

// POST /api/generate/chapter
// body: { config, setup, bible, volume, chapter, prevChapter, ctx?, globalNo?, direction?, prompts?, nextChapter? }
// Streams the chapter prose directly.
export async function POST(req: NextRequest) {
  const {
    config,
    setup,
    bible,
    volume,
    chapter,
    prevChapter,
    ctx,
    globalNo,
    direction,
    prompts,
    nextChapter,
  } = (await req.json()) as {
    config: ApiConfig;
    setup: ProjectSetup;
    bible: StoryBible;
    volume: Volume;
    chapter: Chapter;
    prevChapter: Chapter | null;
    ctx?: ChapterContext;
    globalNo?: number;
    direction?: string;
    prompts?: PromptEntry[];
    nextChapter?: Chapter | null;
  };

  const err = validateConfig(config);
  if (err) return new Response(err, { status: 400 });

  try {
    const stream = await streamChat(
      config,
      buildChapterPrompt(
        setup,
        bible,
        volume,
        chapter,
        prevChapter,
        ctx,
        globalNo,
        direction,
        prompts,
        nextChapter
      ),
      { maxTokens: LLM_MAX_TOKENS }
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

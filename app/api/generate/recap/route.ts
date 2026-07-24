import { NextRequest } from "next/server";
import { completeChat, validateConfig } from "@/lib/llm";
import { buildVolumeArcPrompt, buildStorySoFarPrompt } from "@/lib/prompts";
import type { RecentSummary } from "@/lib/retrieval";
import type { ApiConfig, StoryBible, Volume } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/generate/recap
// mode="volume": { config, mode, volume, chapterSummaries, prevArc? } -> { text }
//   Condense one volume's chapter summaries into a rolling arc summary.
// mode="book":   { config, mode, bible, priorArcs } -> { text }
//   Synthesize finished volumes' arcs into a whole-book "story so far" recap.
// Both return plain prose in { text } (recap prompts do not emit JSON).
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    config: ApiConfig;
    mode: "volume" | "book";
    volume?: Volume;
    chapterSummaries?: RecentSummary[];
    prevArc?: string;
    bible?: StoryBible;
    priorArcs?: { index: number; title: string; arc: string }[];
  };
  const { config, mode } = body;

  const err = validateConfig(config);
  if (err) return new Response(err, { status: 400 });

  try {
    const messages =
      mode === "book"
        ? buildStorySoFarPrompt(
            body.bible as StoryBible,
            body.priorArcs || []
          )
        : buildVolumeArcPrompt(
            body.volume as Volume,
            body.chapterSummaries || [],
            body.prevArc
          );
    const raw = await completeChat(config, messages, { maxTokens: 2048 });
    return Response.json({ text: (raw || "").trim() });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "梳理前情失败";
    return new Response(msg, { status: 502 });
  }
}

import { NextRequest } from "next/server";
import { completeChat, validateConfig } from "@/lib/llm";
import { buildDigestPrompt, extractJson } from "@/lib/prompts";
import type { ChapterDigest } from "@/lib/retrieval";
import type { ApiConfig, Chapter } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/generate/digest
// body: { config, chapter, content, knownCodex, openForeshadows, globalNo? }
// Reads a finished chapter and returns { summary, codex[], foreshadows[] } JSON
// used to keep the codex + foreshadow tables current.
export async function POST(req: NextRequest) {
  const { config, chapter, content, knownCodex, openForeshadows, globalNo } =
    (await req.json()) as {
      config: ApiConfig;
      chapter: Chapter;
      content: string;
      knownCodex: { name: string; status?: string }[];
      openForeshadows: string[];
      globalNo?: number;
    };

  const err = validateConfig(config);
  if (err) return new Response(err, { status: 400 });

  try {
    const raw = await completeChat(
      config,
      buildDigestPrompt(
        chapter,
        content || "",
        knownCodex || [],
        openForeshadows || [],
        globalNo
      ),
      { maxTokens: 2048 }
    );
    const data = extractJson<ChapterDigest>(raw);
    return Response.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "归档失败";
    return new Response(msg, { status: 502 });
  }
}

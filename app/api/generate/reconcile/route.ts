import { NextRequest } from "next/server";
import { completeChat, validateConfig } from "@/lib/llm";
import { buildReconcilePrompt, extractJson } from "@/lib/prompts";
import type {
  ReconcileChange,
  ReconcilePayload,
  ReconcileResult,
} from "@/lib/reconcile";
import type { ApiConfig, StoryBible } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// POST /api/generate/reconcile
// body: { config, change, payload, bible }
// After an upstream artifact is regenerated, reviews the downstream planning
// artifacts and returns { changeSummary, updates[], staleProse[] } so the whole
// book can be re-aligned. Never touches prose (only flags it as possibly stale).
export async function POST(req: NextRequest) {
  const { config, change, payload, bible } = (await req.json()) as {
    config: ApiConfig;
    change: ReconcileChange;
    payload: ReconcilePayload;
    bible: StoryBible | null;
  };

  const err = validateConfig(config);
  if (err) return new Response(err, { status: 400 });

  try {
    const raw = await completeChat(
      config,
      buildReconcilePrompt(change, payload, bible ?? null),
      { maxTokens: 4096 }
    );
    const data = extractJson<ReconcileResult>(raw);
    return Response.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "统一处理失败";
    return new Response(msg, { status: 502 });
  }
}

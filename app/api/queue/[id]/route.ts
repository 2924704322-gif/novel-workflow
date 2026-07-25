import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { getTask } from "@/lib/queue/store";

export const dynamic = "force-dynamic";

// GET /api/queue/[id] — 获取单个任务状态（支持 SSE 轮询）
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await resolveAuth(req);
  const { id } = await params;
  const task = await getTask(id);

  if (!task) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  // SSE 模式：Accept: text/event-stream 时返回实时推送
  const accept = req.headers.get("accept") || "";
  if (accept.includes("text/event-stream")) {
    // 简单实现：每 2 秒轮询状态推送
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let running = true;
        const push = async () => {
          const current = await getTask(id);
          if (!current) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "not_found" })}\n\n`));
            controller.close();
            return;
          }
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(current)}\n\n`));
          if (current.status === "done" || current.status === "failed") {
            controller.close();
            running = false;
          }
        };

        await push();
        const interval = setInterval(async () => {
          if (!running) {
            clearInterval(interval);
            return;
          }
          try {
            await push();
          } catch {
            clearInterval(interval);
            controller.close();
          }
        }, 2000);

        // 客户端断开时清理
        req.signal.addEventListener("abort", () => {
          running = false;
          clearInterval(interval);
          try { controller.close(); } catch {}
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  }

  // 普通 JSON 响应
  return NextResponse.json(task);
}

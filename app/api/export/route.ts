import { NextRequest, NextResponse } from "next/server";
import { resolveAuth } from "@/lib/auth";
import { projectRepository } from "@/lib/repository";
import { exportProject, type ExportFormat } from "@/lib/export";

export const dynamic = "force-dynamic";

// GET /api/export?projectId=xxx&format=epub|markdown|txt[&scope=full|volume&volumeIndex=0&includeOutline=true&includeNotes=true]
export async function GET(req: NextRequest) {
  const { ownerId } = await resolveAuth(req);
  const { searchParams } = new URL(req.url);

  const projectId = searchParams.get("projectId");
  const format = searchParams.get("format") as ExportFormat | null;

  if (!projectId || !format) {
    return NextResponse.json(
      { error: "需要 projectId 和 format 参数" },
      { status: 400 }
    );
  }

  if (!["epub", "markdown", "txt"].includes(format)) {
    return NextResponse.json(
      { error: `不支持的格式：${format}，可选 epub/markdown/txt` },
      { status: 400 }
    );
  }

  const project = await projectRepository.get(ownerId, projectId);
  if (!project) {
    return NextResponse.json({ error: "作品不存在" }, { status: 404 });
  }

  const scope = searchParams.get("scope") === "volume" ? "volume" : "full";
  const volumeIndex = searchParams.get("volumeIndex")
    ? parseInt(searchParams.get("volumeIndex")!, 10)
    : undefined;
  const includeOutline = searchParams.get("includeOutline") === "true";
  const includeNotes = searchParams.get("includeNotes") === "true";

  try {
    const result = await exportProject(project, format, {
      scope,
      volumeIndex,
      includeOutline,
      includeNotes,
    });

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": result.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
      },
    });
  } catch (err) {
    return NextResponse.json(
      { error: `导出失败：${(err as Error).message}` },
      { status: 500 }
    );
  }
}

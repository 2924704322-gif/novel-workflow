"use client";

// 方格稿纸阅读器（FT-08 / FT-09）
// 衬线 + 暖白格线（复用 globals.css 的 .manuscript .reader：var(--paper)/--paper-line/--paper-ink）。
// 展示单章正文：卷·章头 + 正文逐行（落在 .reader 容器内即获得稿纸网格对齐）。

import { useMemo } from "react";
import type { Project } from "@/lib/types";

interface DisplayChapter {
  volumeTitle: string;
  title: string;
  content: string;
}

/** 选定章节：优先 chapterId；否则首章有内容者；再兜底首卷首章。 */
function getDisplayChapter(
  project: Project | null,
  chapterId: string | null
): DisplayChapter | null {
  if (!project) return null;

  if (chapterId) {
    for (const v of project.volumes) {
      for (const c of v.chapters) {
        if (c.id === chapterId) {
          return { volumeTitle: v.title, title: c.title, content: c.content };
        }
      }
    }
    // chapterId 未命中：回退首章有内容者
    for (const v of project.volumes) {
      for (const c of v.chapters) {
        if (c.content && c.content.trim()) {
          return { volumeTitle: v.title, title: c.title, content: c.content };
        }
      }
    }
  }

  // 未指定 chapterId：取首章有内容者
  for (const v of project.volumes) {
    for (const c of v.chapters) {
      if (c.content && c.content.trim()) {
        return { volumeTitle: v.title, title: c.title, content: c.content };
      }
    }
  }

  const fv = project.volumes[0];
  const fc = fv?.chapters[0];
  if (fc) return { volumeTitle: fv.title, title: fc.title, content: fc.content };
  return null;
}

export default function Reader({
  project,
  chapterId,
}: {
  project: Project | null;
  chapterId: string | null;
}) {
  const chapter = useMemo(
    () => getDisplayChapter(project, chapterId),
    [project, chapterId]
  );

  if (!project) {
    return (
      <div className="reader manuscript">
        <p className="muted">未选择书籍</p>
      </div>
    );
  }

  return (
    <div className="reader manuscript">
      {!chapter ? (
        <p className="muted">本书还没有章节。</p>
      ) : (
        <>
          <div className="reader-head">
            <span className="reader-vol">{chapter.volumeTitle}</span>
            <h2 className="reader-title">{chapter.title}</h2>
          </div>
          <div className="reader-body">
            {chapter.content && chapter.content.trim() ? (
              chapter.content
                .split("\n")
                .map((line, i) => <p key={i}>{line === "" ? " " : line}</p>)
            ) : (
              <p className="muted">
                （本章尚未落稿，确认写入章节类 .md 后会显示在这里）
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

"use client";

// 书详情页（FT-08 / FT-09，Q6 大纲·正文·设定落点；FT-11 补挂载暗色三件套；FT-12 状态组件接线）
// 表头（书名 + 三分段 [成果|阅读|文档] + 收起）+ 内容区，分段由 StudioProvider.rightSeg.book 控制。
//   - 成果：logline / 梗概 / 章节列表(状态点，含章节级「版本历史」入口) / 核心设定(meta-tags)。
//   - 阅读：方格稿纸 Reader；确认写入章节类 .md 后落稿；顶栏提供「版本历史」入口。
//   - 文档：DocList(.md 列表) + DocReader(Markdown 渲染)；首开旧书触发 bible→docs 迁移(FT-10)。
// FT-11：成果分段提供「任务队列」「导出作品」入口，分别挂载 TaskQueue / ExportDialog（清爽风模态）；
//        章节级（成果列表）与阅读分段（顶栏）提供 HistoryPanel「版本历史」入口。
// FT-12：加载用 Skeleton、错误用 ErrorNote、空态用 EmptyState（均有真实接线）。

import { useEffect, useState } from "react";
import { useStudio } from "./StudioProvider";
import { fetchProject, fetchDocs, fetchDoc } from "@/lib/client";
import type { DocMeta, DocRecord } from "@/lib/docsStore";
import { projectStats, type ChapterStatus, type Project } from "@/lib/types";
import { PanelRightClose, Clock, Download } from "./icons";
import Reader from "./Reader";
import DocList from "./DocList";
import DocReader from "./DocReader";
import Skeleton from "./Skeleton";
import ErrorNote from "./ErrorNote";
import EmptyState from "./EmptyState";
import TaskQueue from "@/components/TaskQueue";
import HistoryPanel from "@/components/HistoryPanel";
import ExportDialog from "@/components/ExportDialog";

const DOT_CLASS: Record<ChapterStatus, string> = {
  done: "dot dot--write",
  draft: "dot dot--skeleton",
  empty: "dot dot--brew",
};
const DOT_LABEL: Record<ChapterStatus, string> = {
  done: "已完稿",
  draft: "草稿",
  empty: "未写",
};
const PHASE_LABEL: Record<Project["phase"], string> = {
  setup: "筹备",
  outline: "大纲",
  writing: "正文",
};

export default function BookDetail() {
  const {
    selectedBookId,
    rightMode,
    rightSeg,
    openDocName,
    readerChapterId,
    projectVersion,
    switchSeg,
    toggleRight,
    openDoc,
  } = useStudio();

  const [project, setProject] = useState<Project | null>(null);
  const [docs, setDocs] = useState<DocMeta[]>([]);
  const [doc, setDoc] = useState<DocRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docsError, setDocsError] = useState<string | null>(null);

  // FT-11：挂载入口状态
  const [tray, setTray] = useState<null | "task" | "export">(null);
  const [histChapterId, setHistChapterId] = useState<string | null>(null);
  // 历史回滚后刷新阅读内容
  const [refreshTick, setRefreshTick] = useState(0);

  // 加载作品（打开 / 确认写入后刷新）。P0-1 修复：client 不直连 fs，走 /api/projects/:id。
  useEffect(() => {
    if (rightMode !== "book" || !selectedBookId) {
      setProject(null);
      setError(null);
      return;
    }
    let alive = true;
    setError(null);
    fetchProject(selectedBookId)
      .then((p) => {
        if (!alive) return;
        if (p) setProject(p);
        else setError("作品不存在或读取失败");
      })
      .catch((e) => {
        if (alive) setError(e instanceof Error ? e.message : "作品读取失败");
      });
    return () => {
      alive = false;
    };
  }, [selectedBookId, rightMode, projectVersion, refreshTick]);

  // 文档列表（FT-10 首开旧书迁移已下沉到 /api/projects/:id/docs 服务端，幂等）。
  useEffect(() => {
    if (rightMode !== "book" || !selectedBookId || !project) return;
    let alive = true;
    setDocsError(null);
    fetchDocs(selectedBookId)
      .then((list) => {
        if (alive) setDocs(list);
      })
      .catch((e) => {
        if (alive) setDocsError(e instanceof Error ? e.message : "文档读取失败");
      });
    return () => {
      alive = false;
    };
  }, [selectedBookId, rightMode, project, projectVersion, openDocName, refreshTick]);

  // 打开的文档正文
  useEffect(() => {
    if (!openDocName || !selectedBookId) {
      setDoc(null);
      return;
    }
    let alive = true;
    fetchDoc(selectedBookId, openDocName)
      .then((r) => {
        if (alive) setDoc(r);
      })
      .catch(() => {
        if (alive) setDoc(null);
      });
    return () => {
      alive = false;
    };
  }, [selectedBookId, openDocName, projectVersion]);

  const seg = rightSeg.book;
  const loading = rightMode === "book" && !!selectedBookId && !project && !error;

  return (
    <>
      <div className="detail-head">
        <span className="detail-title">{project?.title ?? "书详情"}</span>
        <div className="seg">
          <button
            type="button"
            className={seg === "result" ? "on" : ""}
            onClick={() => switchSeg("book", "result")}
          >
            成果
          </button>
          <button
            type="button"
            className={seg === "reader" ? "on" : ""}
            onClick={() => switchSeg("book", "reader")}
          >
            阅读
          </button>
          <button
            type="button"
            className={seg === "doc" ? "on" : ""}
            onClick={() => switchSeg("book", "doc")}
          >
            文档
          </button>
        </div>
        {/* FT-11：阅读分段提供章节级「版本历史」入口 */}
        {seg === "reader" && readerChapterId && (
          <button
            type="button"
            className="btn-ghost btn-sm"
            onClick={() => setHistChapterId(readerChapterId)}
            title="版本历史"
          >
            <Clock size={14} /> 版本历史
          </button>
        )}
        <button
          type="button"
          className="detail-close"
          onClick={toggleRight}
          title="收起"
          aria-label="收起"
        >
          <PanelRightClose size={16} />
        </button>
      </div>

      {error ? (
        <div className="right-rail">
          <ErrorNote>作品读取失败：{error}</ErrorNote>
        </div>
      ) : loading ? (
        // FT-12：加载用骨架屏
        <div className="right-rail">
          <Skeleton height={18} style={{ maxWidth: 180, marginBottom: 16 }} />
          <Skeleton height={12} style={{ marginBottom: 10 }} />
          <Skeleton height={12} style={{ marginBottom: 10, maxWidth: "90%" }} />
          <Skeleton height={12} style={{ maxWidth: "75%" }} />
        </div>
      ) : !project ? (
        <div className="right-rail">
          <p className="faint">未选择书籍</p>
        </div>
      ) : seg === "result" ? (
        <>
          {/* FT-11：成果分段挂载入口（任务队列 / 导出） */}
          <div className="result-toolbar">
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setTray("task")}
            >
              <Clock size={14} /> 任务队列
            </button>
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => setTray("export")}
            >
              <Download size={14} /> 导出作品
            </button>
          </div>
          <BookResult
            project={project}
            onChapterHistory={(id) => setHistChapterId(id)}
          />
        </>
      ) : seg === "reader" ? (
        <Reader project={project} chapterId={readerChapterId} />
      ) : openDocName && doc ? (
        <div className="doc-pane">
          <div className="doc-pane-bar">
            <button type="button" className="link-btn" onClick={() => openDoc("")}>
              ← 文档列表
            </button>
          </div>
          <DocReader record={doc} />
        </div>
      ) : docsError ? (
        // FT-12：文档读取错误用错误条
        <div className="right-rail">
          <ErrorNote>文档读取失败：{docsError}</ErrorNote>
        </div>
      ) : (
        <DocList docs={docs} activeName={openDocName} onPick={(n) => openDoc(n)} />
      )}

      {/* FT-11：任务队列（清爽风模态挂载） */}
      {tray === "task" && (
        <div className="modal-overlay" onClick={() => setTray(null)}>
          <div
            className="modal-panel wide"
            onClick={(e) => e.stopPropagation()}
          >
            <TaskQueue
              projectId={selectedBookId ?? undefined}
              onClose={() => setTray(null)}
            />
          </div>
        </div>
      )}

      {/* FT-11：导出作品（ExportDialog 自带清爽风模态） */}
      {tray === "export" && project && (
        <ExportDialog
          projectId={project.id}
          projectTitle={project.title}
          volumeCount={project.volumes.length}
          open
          onClose={() => setTray(null)}
        />
      )}

      {/* FT-11：版本历史（章节级，清爽风模态挂载） */}
      {histChapterId && project && (
        <div className="modal-overlay" onClick={() => setHistChapterId(null)}>
          <div
            className="modal-panel wide"
            onClick={(e) => e.stopPropagation()}
          >
            <HistoryPanel
              projectId={project.id}
              chapterId={histChapterId}
              onRestore={() => setRefreshTick((t) => t + 1)}
              onClose={() => setHistChapterId(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}

/** 成果分段：内核 / 梗概 / 章节列表(状态点 + 章节级版本历史入口) / 核心设定。 */
function BookResult({
  project,
  onChapterHistory,
}: {
  project: Project;
  onChapterHistory: (chapterId: string) => void;
}) {
  const stats = projectStats(project);
  const bible = project.bible;

  const tags: string[] = [];
  if (project.setup.genre) tags.push(project.setup.genre);
  tags.push(PHASE_LABEL[project.phase]);
  if (project.setup.rating) tags.push(project.setup.rating);
  const wan = Math.round(project.setup.targetWords / 10000);
  if (wan) tags.push(`目标 ${wan} 万字`);
  if (bible?.themes) {
    bible.themes
      .split(/[，。\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 4)
      .forEach((t) => tags.push(t));
  }

  const chapters = project.volumes.flatMap((v) => v.chapters);

  return (
    <div className="right-rail result">
      {bible?.logline && (
        <section className="result-block">
          <h3>故事内核</h3>
          <p>{bible.logline}</p>
        </section>
      )}
      {bible?.synopsis && (
        <section className="result-block">
          <h3>梗概</h3>
          <p>{bible.synopsis}</p>
        </section>
      )}

      <section className="result-block">
        <h3>章节（{stats.chapterCount}）</h3>
        {chapters.length === 0 ? (
          // FT-12：空态组件
          <EmptyState
            title="还没有章节"
            hint="在对话中用「章节」快速创作，确认写入后会出现在这里。"
          />
        ) : (
          <div className="chapter-list">
            {chapters.map((c) => (
              <div key={c.id} className="chapter-row">
                <span className={DOT_CLASS[c.status]} aria-hidden />
                <span className="chapter-name">{c.title}</span>
                <span className="faint" style={{ fontSize: 12 }}>
                  {DOT_LABEL[c.status]}·{c.wordCount}字
                </span>
                {/* FT-11：章节级「版本历史」入口 */}
                <button
                  type="button"
                  className="row-hist"
                  onClick={() => onChapterHistory(c.id)}
                  title="版本历史"
                >
                  历史
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {tags.length > 0 && (
        <section className="result-block">
          <h3>核心设定</h3>
          <div className="meta-tags">
            {tags.map((t, i) => (
              <span key={i} className="tag">
                {t}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

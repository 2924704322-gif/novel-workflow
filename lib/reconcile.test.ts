// reconcile.ts 纯函数单测：一致性统一 applyReconcile 的合并逻辑。
// 仅用内存 fixture，不依赖模型调用。
import { describe, it, expect, vi } from "vitest";
import {
  applyReconcile,
  collectDownstream,
  hasReconcileContent,
  type ReconcileResult,
} from "./reconcile";
import { makeProject } from "./__tests__/fixtures";

// applyReconcile 对章节脉络/标题会写入 updatedAt: Date.now()，冻结时间以保证
// 幂等性断言（重复应用结果一致）稳定。
vi.useFakeTimers();

describe("applyReconcile（一致性统一合并）", () => {
  const updates: ReconcileResult["updates"] = [
    { kind: "volume-summary", volumeId: "v1", value: "卷一概述(已统一)" },
    { kind: "chapter-synopsis", chapterId: "c2", value: "第二章脉络(已统一)" },
    { kind: "chapter-title", chapterId: "c2", value: "第二章·新标题" },
    { kind: "chapter-summary", chapterId: "c1", value: "第一章摘要(已统一)" },
  ];

  it("按 id + kind 精确回写卷摘要与章节字段", () => {
    const p = makeProject();
    const next = applyReconcile(p, { changeSummary: "统一", updates });
    expect(next.volumes[0].summary).toBe("卷一概述(已统一)");
    const c2 = next.volumes[0].chapters[1];
    expect(c2.synopsis).toBe("第二章脉络(已统一)");
    expect(c2.title).toBe("第二章·新标题");
    expect(next.volumes[0].chapters[0].summary).toBe("第一章摘要(已统一)");
    // 原工程未被改动
    expect(p.volumes[0].summary).toBe("");
  });

  it("空 value 与未知 id 被安全忽略", () => {
    const p = makeProject();
    const safe: ReconcileResult = {
      changeSummary: "",
      updates: [
        { kind: "volume-summary", volumeId: "v1", value: "   " },
        { kind: "chapter-synopsis", chapterId: "不存在", value: "改写" },
      ],
    };
    const next = applyReconcile(p, safe);
    expect(next.volumes[0].summary).toBe("");
    expect(p.volumes[0].chapters.some((c) => c.synopsis === "改写")).toBe(false);
  });

  it("无有效更新时返回原工程（引用不变，零拷贝）", () => {
    const p = makeProject();
    const next = applyReconcile(p, { changeSummary: "", updates: [] });
    expect(next).toBe(p);
  });

  it("重复应用同一结果得到完全一致的新工程（幂等）", () => {
    const p = makeProject();
    const a = applyReconcile(p, { changeSummary: "统一", updates });
    const b = applyReconcile(a, { changeSummary: "统一", updates });
    expect(b).toEqual(a);
    // 章节数量不增（覆盖而非追加）
    expect(b.volumes[0].chapters).toHaveLength(p.volumes[0].chapters.length);
  });
});

describe("collectDownstream / hasReconcileContent", () => {
  it("仅收集带规划/连续性文本的下游章节，并按上限截断", () => {
    const p = makeProject();
    const payload = collectDownstream(p, { fromGlobal: 1, cap: 60 });
    // c1(有摘要)、c2(有摘要) 命中；c4 无文本被跳过
    expect(payload.chapters.map((c) => c.chapterId)).toEqual(["c1", "c2"]);
    expect(payload.truncated).toBe(false);
  });

  it("hasReconcileContent 正确识别有无内容", () => {
    expect(hasReconcileContent(null)).toBe(false);
    expect(hasReconcileContent({ changeSummary: "", updates: [], staleProse: [] })).toBe(false);
    expect(hasReconcileContent({ changeSummary: "有改动", updates: [] })).toBe(true);
  });
});

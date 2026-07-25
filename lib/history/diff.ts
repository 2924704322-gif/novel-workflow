// 章节版本历史 —— 行级 diff（LCS 算法自实现，无外部依赖）。

import type { DiffLine, DiffResult } from "./types";

/**
 * 对两段文本执行行级 diff，返回差异结果。
 * 基于最长公共子序列(LCS)算法。
 */
export function diffChapters(oldText: string, newText: string): DiffResult {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);

  // 构建 LCS 表
  const m = oldLines.length;
  const n = newLines.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (oldLines[i - 1] === newLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  // 回溯生成 diff
  const lines: DiffLine[] = [];
  let i = m;
  let j = n;

  const stack: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
      stack.push({ type: "equal", content: oldLines[i - 1], oldLineNo: i, newLineNo: j });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      stack.push({ type: "add", content: newLines[j - 1], newLineNo: j });
      j--;
    } else {
      stack.push({ type: "delete", content: oldLines[i - 1], oldLineNo: i });
      i--;
    }
  }

  // 翻转（回溯是逆序的）
  for (let k = stack.length - 1; k >= 0; k--) {
    lines.push(stack[k]);
  }

  let addedCount = 0;
  let deletedCount = 0;
  let unchangedCount = 0;
  for (const l of lines) {
    if (l.type === "add") addedCount++;
    else if (l.type === "delete") deletedCount++;
    else unchangedCount++;
  }

  return { lines, addedCount, deletedCount, unchangedCount };
}

function splitLines(text: string): string[] {
  if (!text) return [];
  return text.split(/\r?\n/);
}

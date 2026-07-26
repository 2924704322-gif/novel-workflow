// 轻量零依赖 Markdown → HTML 渲染器（FT-08 / Q8，react-markdown 离线兜底）。
//
// 设计取舍（GitHub 取经结论）：
//   - 联网环境选定 react-markdown + remark-gfm（默认不渲染原始 HTML，安全），
//     DocReader 应优先用前者；本文件是沙箱离线 / 体积考量下的兜底实现。
//   - react-markdown 离线装不上时，本渲染器实现 GFM 子集（标题/段落/列表/
//     引用/代码块/分割线/链接/粗斜体），并**先转义 HTML 特殊字符**，杜绝 XSS。
//   - 结构对齐 remark 系：先按块（block）切分，再对行内（inline）做富文本替换。
//
// 联网安装 react-markdown 后，DocReader 改回：
//   import ReactMarkdown from "react-markdown";
//   import remarkGfm from "remark-gfm";
//   <ReactMarkdown remarkPlugins={[remarkGfm]}>{record.body}</ReactMarkdown>

/** 转义 HTML 特殊字符，防止注入。 */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** 仅放行安全协议的链接地址。 */
function sanitizeUrl(url: string): string {
  const u = url.trim();
  if (/^(https?:\/\/|mailto:|\/|#|\.\/|\.\.\/)/i.test(u)) return u;
  return "#";
}

/** 行内渲染：代码 / 粗体 / 斜体 / 链接（输入已转义，仅做结构替换）。 */
function renderInline(text: string): string {
  let s = escapeHtml(text);
  s = s.replace(/`([^`]+)`/g, (_m, c) => `<code>${c}</code>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*]+)\*/g, "<em>$1</em>");
  s = s.replace(/_([^_]+)_/g, "<em>$1</em>");
  s = s.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_m, t, u) =>
      `<a href="${sanitizeUrl(u)}" target="_blank" rel="noopener noreferrer">${t}</a>`
  );
  return s;
}

/**
 * 把一段 Markdown 文本渲染为 HTML 字符串。
 * 支持：围栏代码块 ```、标题 #~######、引用 >、无序/有序列表、分割线、段落、行内格式。
 */
export function renderMarkdown(md: string): string {
  const lines = (md || "").replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let i = 0;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      out.push(`<p>${renderInline(para.join(" "))}</p>`);
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // 围栏代码块 ```
    const fence = /^```(\w*)\s*$/.exec(line);
    if (fence) {
      flushPara();
      const lang = fence[1] || "";
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // 跳过收尾 ```
      out.push(
        `<pre><code${lang ? ` class="lang-${lang}"` : ""}>${escapeHtml(
          code.join("\n")
        )}</code></pre>`
      );
      continue;
    }

    // 分割线
    if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flushPara();
      out.push("<hr/>");
      i++;
      continue;
    }

    // 标题
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      const lvl = h[1].length;
      out.push(`<h${lvl}>${renderInline(h[2])}</h${lvl}>`);
      i++;
      continue;
    }

    // 引用块
    if (/^>\s?/.test(line)) {
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderInline(quote.join(" "))}</blockquote>`);
      continue;
    }

    // 无序列表
    if (/^[-*+]\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^[-*+]\s+/.test(lines[i])) {
        items.push(
          `<li>${renderInline(lines[i].replace(/^[-*+]\s+/, ""))}</li>`
        );
        i++;
      }
      out.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // 有序列表
    if (/^\d+\.\s+/.test(line)) {
      flushPara();
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${renderInline(lines[i].replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      out.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // 空行
    if (line.trim() === "") {
      flushPara();
      i++;
      continue;
    }

    // 段落文本
    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join("\n");
}

import type { Metadata } from "next";
import "./globals.css";

// 根布局：仅承担 html/body 包装与全局令牌（globals.css）。
// 新三栏 Studio 外壳由 / 路由的 StudioProvider + StudioShell 接管（FT-03），
// 故此处不再包裹旧 AppShell；同时移除 Google Fonts 在线依赖，改用
// globals.css 内 @font-face 指向本地离线字体（FT-13 / Q2）。
export const metadata: Metadata = {
  title: "Novel&Chat · 长篇小说 AI 创作工作流",
  description:
    "本地优先的长篇小说 AI 创作工作流：左侧纯导航、中间纯对话、右侧可收起展示。",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

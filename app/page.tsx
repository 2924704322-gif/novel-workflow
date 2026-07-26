"use client";

// 新主界面根屏 `/`（FT-03）：挂载工作室共享状态 + 新三栏外壳。
// 中栏先放 ChatStudio 占位（FT-05 实现），右栏放 RightDock 占位（FT-08 实现）。
import StudioProvider from "@/components/studio/StudioProvider";
import StudioShell from "@/components/studio/StudioShell";

export default function HomePage() {
  return (
    <StudioProvider>
      <StudioShell />
    </StudioProvider>
  );
}

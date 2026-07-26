/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle at .next/standalone so Electron can
  // launch it directly (see electron/main.js) without a full node_modules.
  output: "standalone",
  // The desktop build has no image optimization server; skip it to avoid
  // pulling the native `sharp` binary into the packaged app.
  images: { unoptimized: true },
  // 测试/CI 阶段单独跑 ESLint 作为门禁；为避免历史告警阻断既有打包流程，
  // 这里关闭 next build 自带的 lint（墨章 Novel Atelier 测试安全网，P1-3）。
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;

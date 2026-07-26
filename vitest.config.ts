// Vitest 配置（墨章 Novel Atelier 测试安全网）
// 仅用 esbuild 转译 TS，无需 babel。测试运行在 node 环境（纯函数单测，
// 不依赖网络 / 真实 LLM / 文件系统），覆盖 lib/ 下的纯逻辑。
import { fileURLToPath } from "node:url";
import path from "node:path";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts"],
    // 仅对 lib 下纯函数做单测，避免拉起 Next / Electron 运行时
  },
  resolve: {
    alias: {
      // 与 tsconfig 的 paths 对齐，便于个别模块经 "@/..." 互引时能解析
      "@": root,
    },
  },
});

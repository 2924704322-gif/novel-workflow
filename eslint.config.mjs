// ESLint flat config（墨章 Novel Atelier）
// 继承 Next.js 官方推荐规则 next/core-web-vitals。Next 15 已弃用 `next lint`
// 对 flat config 的支持，因此 `package.json` 的 lint 脚本改为直接 `eslint .`，
// 由本文件驱动。next build 的 lint 已在 next.config.mjs 中设为 ignoreDuringBuilds，
// 避免历史告警阻断既有打包流程；lint 作为 CI 门禁单独运行。
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  ...compat.extends("next/core-web-vitals"),
  {
    // 测试与配置文件不参与业务 lint；vitest 全局类型等在此放行
    ignores: [
      "node_modules/**",
      ".next/**",
      "dist/**",
      "build/**",
      "lib/**/*.test.ts",
      "vitest.config.ts",
      "eslint.config.mjs",
    ],
  },
];

export default eslintConfig;

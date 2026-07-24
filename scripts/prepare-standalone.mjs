// After `next build` with output:"standalone", Next emits a minimal server at
// .next/standalone but does NOT copy the static assets or the public/ folder
// into it. The Electron app ships that standalone dir, so we copy them in here
// to their expected locations before packaging.
import { cpSync, existsSync, mkdirSync } from "fs";
import path from "path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");

if (!existsSync(standalone)) {
  console.error(
    "[prepare-standalone] .next/standalone 不存在，请先运行 `next build`。"
  );
  process.exit(1);
}

// .next/static -> .next/standalone/.next/static
const staticSrc = path.join(root, ".next", "static");
const staticDest = path.join(standalone, ".next", "static");
if (existsSync(staticSrc)) {
  mkdirSync(path.dirname(staticDest), { recursive: true });
  cpSync(staticSrc, staticDest, { recursive: true });
  console.log("[prepare-standalone] copied .next/static");
}

// public -> .next/standalone/public (skipped if the project has no public/)
const publicSrc = path.join(root, "public");
const publicDest = path.join(standalone, "public");
if (existsSync(publicSrc)) {
  cpSync(publicSrc, publicDest, { recursive: true });
  console.log("[prepare-standalone] copied public/");
}

console.log("[prepare-standalone] done.");

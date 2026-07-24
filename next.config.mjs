/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Emit a self-contained server bundle at .next/standalone so Electron can
  // launch it directly (see electron/main.js) without a full node_modules.
  output: "standalone",
  // The desktop build has no image optimization server; skip it to avoid
  // pulling the native `sharp` binary into the packaged app.
  images: { unoptimized: true },
};

export default nextConfig;

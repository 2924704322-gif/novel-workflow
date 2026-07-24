// One-off generator for the placeholder app icon (build/icon.ico).
//
// No brand artwork was supplied, so we render a warm-palette placeholder:
// the character "墨" on a cream→amber gradient rounded square, then pack the
// rendered PNG frames into a multi-resolution Windows .ico.
//
// Re-run with `node scripts/generate-icon.mjs` if the brand mark changes.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "fs";
import path from "path";

const root = process.cwd();
const outDir = path.join(root, "build");
mkdirSync(outDir, { recursive: true });

// Vector source: a rounded square with a warm gradient and the ink character.
function svg(size) {
  const r = Math.round(size * 0.22);
  const fontSize = Math.round(size * 0.6);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#faf6f0"/>
      <stop offset="100%" stop-color="#e8c9a0"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="url(#bg)"/>
  <text x="50%" y="52%" text-anchor="middle" dominant-baseline="central"
        font-family="'Microsoft YaHei','SimHei','Noto Sans CJK SC',sans-serif"
        font-weight="700" font-size="${fontSize}" fill="#3a2c1e">墨</text>
</svg>`;
}

// ICO container packs one directory entry + PNG payload per size (PNG frames
// are valid on Windows Vista+ and keep the file small).
const sizes = [16, 24, 32, 48, 64, 128, 256];

const pngs = await Promise.all(
  sizes.map((s) =>
    sharp(Buffer.from(svg(s))).resize(s, s).png().toBuffer()
  )
);

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(sizes.length, 4); // image count

const entries = [];
let offset = 6 + sizes.length * 16;
sizes.forEach((s, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(s >= 256 ? 0 : s, 0); // width (0 means 256)
  entry.writeUInt8(s >= 256 ? 0 : s, 1); // height
  entry.writeUInt8(0, 2); // palette count
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // color planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngs[i].length, 8); // bytes in resource
  entry.writeUInt32LE(offset, 12); // offset from file start
  offset += pngs[i].length;
  entries.push(entry);
});

const ico = Buffer.concat([header, ...entries, ...pngs]);
writeFileSync(path.join(outDir, "icon.ico"), ico);
// Also drop a 512px PNG for platforms/tools that prefer PNG source art.
writeFileSync(
  path.join(outDir, "icon.png"),
  await sharp(Buffer.from(svg(512))).resize(512, 512).png().toBuffer()
);
console.log(`[generate-icon] wrote build/icon.ico (${ico.length} bytes) and build/icon.png`);

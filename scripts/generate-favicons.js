// scripts/generate-favicons.js
// Rasterize favicon.svg → apple-touch-icon.png (180x180) and favicon.ico.
// Run: node scripts/generate-favicons.js
//
// Kept as a one-shot utility: when the brand mark changes, edit
// favicon.svg, re-run, commit the updated PNG + ICO.

import sharp from "sharp";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const srcSvg = readFileSync(path.join(rootDir, "favicon.svg"));

// Apple touch icon — 180 × 180, on-brand dark background baked in.
await sharp(srcSvg, { density: 1800 })
  .resize(180, 180)
  .png()
  .toFile(path.join(rootDir, "apple-touch-icon.png"));

// Favicon ICO — pack 16 + 32 + 48 sized PNGs into a multi-resolution ICO.
// sharp doesn't emit ICO directly; hand-build the container.
async function pngBuffer(size) {
  return await sharp(srcSvg, { density: size * 60 })
    .resize(size, size)
    .png()
    .toBuffer();
}

const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map(pngBuffer));

// ICONDIR (6 bytes) + ICONDIRENTRY (16 bytes × N) + image data
const headerLen = 6 + 16 * sizes.length;
const totalLen = headerLen + pngs.reduce((s, b) => s + b.length, 0);
const ico = Buffer.alloc(totalLen);

ico.writeUInt16LE(0, 0);                 // reserved
ico.writeUInt16LE(1, 2);                 // type: ICO
ico.writeUInt16LE(sizes.length, 4);      // image count

let offset = headerLen;
sizes.forEach((size, i) => {
  const entry = 6 + 16 * i;
  const buf = pngs[i];
  ico.writeUInt8(size === 256 ? 0 : size, entry);      // width
  ico.writeUInt8(size === 256 ? 0 : size, entry + 1);  // height
  ico.writeUInt8(0, entry + 2);                         // palette
  ico.writeUInt8(0, entry + 3);                         // reserved
  ico.writeUInt16LE(1, entry + 4);                      // color planes
  ico.writeUInt16LE(32, entry + 6);                     // bits per pixel
  ico.writeUInt32LE(buf.length, entry + 8);             // image size
  ico.writeUInt32LE(offset, entry + 12);                // image offset
  buf.copy(ico, offset);
  offset += buf.length;
});

writeFileSync(path.join(rootDir, "favicon.ico"), ico);
console.log("Wrote apple-touch-icon.png (180×180) and favicon.ico (16 + 32 + 48).");

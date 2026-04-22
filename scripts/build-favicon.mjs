// One-off favicon builder.
// Reads favicon.svg and produces favicon.ico (16/32/48 multi-size, PNG-embedded)
// and apple-touch-icon.png (180×180). Run with: node scripts/build-favicon.mjs
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svgPath = resolve(root, 'favicon.svg');
const icoPath = resolve(root, 'favicon.ico');
const appleTouchPath = resolve(root, 'apple-touch-icon.png');

const svg = await readFile(svgPath);

async function rasterize(size) {
  return sharp(svg, { density: Math.max(72, size * 4) })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

// Build PNG-embedded ICO. Each ICONDIRENTRY points at a complete PNG.
function packIco(pngs) {
  const count = pngs.length;
  const dir = Buffer.alloc(6 + 16 * count);
  dir.writeUInt16LE(0, 0);     // reserved
  dir.writeUInt16LE(1, 2);     // type = icon
  dir.writeUInt16LE(count, 4); // image count

  let offset = dir.length;
  const entries = [];
  for (let i = 0; i < count; i++) {
    const { size, buf } = pngs[i];
    const e = 6 + i * 16;
    dir.writeUInt8(size === 256 ? 0 : size, e + 0);  // width (0 = 256)
    dir.writeUInt8(size === 256 ? 0 : size, e + 1);  // height
    dir.writeUInt8(0, e + 2);                        // palette colors
    dir.writeUInt8(0, e + 3);                        // reserved
    dir.writeUInt16LE(1, e + 4);                     // color planes
    dir.writeUInt16LE(32, e + 6);                    // bits per pixel
    dir.writeUInt32LE(buf.length, e + 8);            // image size
    dir.writeUInt32LE(offset, e + 12);               // image offset
    entries.push(buf);
    offset += buf.length;
  }
  return Buffer.concat([dir, ...entries]);
}

const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map(async (size) => ({ size, buf: await rasterize(size) })));
const ico = packIco(pngs);
await writeFile(icoPath, ico);

const apple = await sharp(svg, { density: 720 })
  .resize(180, 180, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(appleTouchPath, apple);

console.log(`favicon.ico  ${ico.length} bytes  (${sizes.join('/')})`);
console.log(`apple-touch-icon.png  ${apple.length} bytes  (180x180)`);

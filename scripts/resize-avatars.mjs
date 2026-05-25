// Bulk-resize talent avatars from 340×340 PNG to 256×256 WebP.
//
// Source: packages/client/public/avatars/*.png
// Output: packages/client/public/avatars/*.webp (PNGs are deleted on success)
//
// Run from repo root: `node scripts/resize-avatars.mjs`
// Idempotent: re-running on a directory that's already .webp is a no-op.

import { readdir, readFile, writeFile, rm, stat } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
// Pulls @napi-rs/canvas from the server package's node_modules. Avoids
// adding it to the workspace root just for a one-off script.
import { createCanvas, loadImage } from "../packages/server/node_modules/@napi-rs/canvas/index.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const AVATAR_DIR = resolve(__dirname, "..", "packages/client/public/avatars");

const TARGET_SIZE = 256;
const QUALITY = 82; // perceptually lossless for circular crops at <=120px display

async function main() {
  const entries = (await readdir(AVATAR_DIR)).filter((f) => f.endsWith(".png"));
  if (entries.length === 0) {
    console.log("No .png files to convert.");
    return;
  }

  let beforeBytes = 0;
  let afterBytes = 0;

  for (const name of entries) {
    const srcPath = resolve(AVATAR_DIR, name);
    const dstName = name.replace(/\.png$/i, ".webp");
    const dstPath = resolve(AVATAR_DIR, dstName);

    const srcStat = await stat(srcPath);
    beforeBytes += srcStat.size;

    const img = await loadImage(await readFile(srcPath));
    const canvas = createCanvas(TARGET_SIZE, TARGET_SIZE);
    const ctx = canvas.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, TARGET_SIZE, TARGET_SIZE);
    const webp = canvas.toBuffer("image/webp", QUALITY);
    await writeFile(dstPath, webp);
    afterBytes += webp.length;

    await rm(srcPath);
    console.log(
      `  ${name.padEnd(30)} ${(srcStat.size / 1024).toFixed(0).padStart(5)} KB → ${(webp.length / 1024).toFixed(0).padStart(4)} KB`,
    );
  }

  console.log(
    `\nDone. ${entries.length} files, ${(beforeBytes / 1024 / 1024).toFixed(2)} MB → ${(afterBytes / 1024 / 1024).toFixed(2)} MB`,
  );
  console.log(
    `Reduction: ${(100 - (afterBytes / beforeBytes) * 100).toFixed(1)}%`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// tsc only emits compiled .js files into dist/ — it doesn't copy raw data
// files like icon-manifest.json. This script copies everything under
// src/data into dist/data after the TypeScript build so the compiled
// server (which reads that file relative to its own __dirname) can find it
// in production, not just in local dev (which runs straight from src/).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcDataDir = path.join(__dirname, "..", "src", "data");
const distDataDir = path.join(__dirname, "..", "dist", "data");

fs.mkdirSync(distDataDir, { recursive: true });

const files = fs.readdirSync(srcDataDir);
for (const file of files) {
  fs.copyFileSync(path.join(srcDataDir, file), path.join(distDataDir, file));
}

console.log(`copyAssets: copied ${files.length} file(s) from src/data to dist/data`);

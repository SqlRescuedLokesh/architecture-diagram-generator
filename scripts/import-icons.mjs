// One-time (re-runnable) import of the official Azure Public Service Icons zip
// into client/public/icons/azure/<slug-category>/<file>.svg
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import unzipper from "unzipper";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const zipPathArg = process.argv[2];
if (!zipPathArg) {
  console.error(
    "Usage: node scripts/import-icons.mjs <path-to-Azure_Public_Service_Icons_VXX.zip>"
  );
  process.exit(1);
}
const zipPath = path.resolve(zipPathArg);
const destRoot = path.join(ROOT, "client", "public", "icons", "azure");

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function main() {
  await fs.rm(destRoot, { recursive: true, force: true });
  await fs.mkdir(destRoot, { recursive: true });

  const directory = await unzipper.Open.file(zipPath);
  let count = 0;

  for (const entry of directory.files) {
    if (entry.type !== "File") continue;
    if (!entry.path.toLowerCase().endsWith(".svg")) continue;

    // entry.path looks like: Azure_Public_Service_Icons/Icons/<category>/<file>.svg
    const parts = entry.path.split("/");
    const iconsIdx = parts.findIndex((p) => p === "Icons");
    if (iconsIdx === -1 || parts.length < iconsIdx + 3) continue;

    const category = parts[iconsIdx + 1];
    const filename = parts[parts.length - 1];
    const destDir = path.join(destRoot, slugify(category));
    await fs.mkdir(destDir, { recursive: true });

    const destFile = path.join(destDir, filename);
    const content = await entry.buffer();
    await fs.writeFile(destFile, content);
    count++;
  }

  console.log(`Imported ${count} icons into ${destRoot}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

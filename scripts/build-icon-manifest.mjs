// Scans client/public/icons/azure and writes server/src/data/icon-manifest.json
// [{ id, name, category, path }] used for server-side fuzzy icon matching.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const iconsRoot = path.join(ROOT, "client", "public", "icons", "azure");
const outFile = path.join(ROOT, "server", "src", "data", "icon-manifest.json");

function cleanName(filename) {
  // e.g. "10787-icon-service-Azure-Databricks.svg" -> "Azure Databricks"
  const base = filename.replace(/\.svg$/i, "");
  const withoutId = base.replace(/^\d+-icon-service-/i, "");
  return withoutId.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

async function main() {
  const categories = await fs.readdir(iconsRoot, { withFileTypes: true });
  const manifest = [];

  for (const catEntry of categories) {
    if (!catEntry.isDirectory()) continue;
    const category = catEntry.name;
    const catDir = path.join(iconsRoot, category);
    const files = await fs.readdir(catDir);

    for (const file of files) {
      if (!file.toLowerCase().endsWith(".svg")) continue;
      const name = cleanName(file);
      manifest.push({
        id: `${category}/${file}`,
        name,
        category,
        path: `/icons/azure/${category}/${file}`,
      });
    }
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(manifest, null, 2));
  console.log(`Wrote ${manifest.length} icon entries to ${outFile}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

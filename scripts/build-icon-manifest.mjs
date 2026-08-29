// Scans client/public/icons (the Azure pack plus any vendor packs) and writes
// server/src/data/icon-manifest.json -> [{ id, name, category, vendor, path, aliases }]
// used for server-side icon matching.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const iconsRoot = path.join(ROOT, "client", "public", "icons");
const azureRoot = path.join(iconsRoot, "azure");
const vendorRoot = path.join(iconsRoot, "vendor");
const outFile = path.join(ROOT, "server", "src", "data", "icon-manifest.json");
const aliasFile = path.join(__dirname, "icon-aliases.json");

const IMAGE_EXT = /\.(svg|png)$/i;

function cleanName(filename) {
  // e.g. "10787-icon-service-Azure-Databricks.svg" -> "Azure Databricks"
  const base = filename.replace(IMAGE_EXT, "");
  const withoutId = base.replace(/^\d+-icon-service-/i, "");
  return withoutId.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}

async function readDirs(root) {
  return fs
    .readdir(root, { withFileTypes: true })
    .then((entries) => entries.filter((e) => e.isDirectory()).map((e) => e.name))
    .catch(() => []);
}

async function collectAzure() {
  const out = [];
  for (const category of await readDirs(azureRoot)) {
    for (const file of await fs.readdir(path.join(azureRoot, category))) {
      if (!IMAGE_EXT.test(file)) continue;
      out.push({
        id: `azure/${category}/${file}`,
        name: cleanName(file),
        category,
        vendor: "azure",
        path: `/icons/azure/${category}/${file}`,
        aliases: [],
      });
    }
  }
  return out;
}

/** Vendor packs carry a meta.json sidecar (written by import-vendor-icons.mjs) with
 * the official display name and any extra names the icon should match on. */
async function collectVendors() {
  const out = [];
  for (const vendor of await readDirs(vendorRoot)) {
    const dir = path.join(vendorRoot, vendor);
    const meta = await fs
      .readFile(path.join(dir, "meta.json"), "utf-8")
      .then(JSON.parse)
      .catch(() => ({ icons: {} }));

    for (const file of await fs.readdir(dir)) {
      if (!IMAGE_EXT.test(file)) continue;
      const entry = meta.icons?.[file] ?? {};
      out.push({
        id: `vendor/${vendor}/${file}`,
        name: entry.name ?? cleanName(file),
        category: vendor,
        vendor,
        path: `/icons/vendor/${vendor}/${file}`,
        aliases: entry.aliases ?? [],
      });
    }
  }
  return out;
}

async function main() {
  const manifest = [...(await collectAzure()), ...(await collectVendors())];

  // Hand-written aliases for services the icon pack names differently (or not at all).
  const overrides = await fs.readFile(aliasFile, "utf-8").then(JSON.parse).catch(() => ({}));
  for (const [id, aliases] of Object.entries(overrides)) {
    if (id.startsWith("_")) continue;
    const entry = manifest.find((i) => i.id === id);
    if (!entry) {
      console.warn(`icon-aliases.json: no icon with id "${id}" - alias ignored`);
      continue;
    }
    entry.aliases = [...new Set([...entry.aliases, ...aliases])];
  }

  await fs.mkdir(path.dirname(outFile), { recursive: true });
  await fs.writeFile(outFile, JSON.stringify(manifest, null, 2));
  const byVendor = manifest.reduce((acc, i) => ({ ...acc, [i.vendor]: (acc[i.vendor] ?? 0) + 1 }), {});
  console.log(`Wrote ${manifest.length} icon entries to ${outFile}`);
  console.log(byVendor);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

// Imports a NON-Azure icon pack (Databricks, Snowflake, SAP, Power BI, ...) into
// client/public/icons/vendor/<vendor>/. Kept separate from import-icons.mjs because
// that script wipes client/public/icons/azure on every run - vendor icons live in
// their own root so re-importing the Azure pack never deletes them.
//
// Usage:
//   node scripts/import-vendor-icons.mjs --vendor <slug> [options] <zip-or-image>
//
//   --vendor <slug>     required, becomes the folder + manifest category
//   --dir <prefix>      zip only: only import entries whose path starts with this
//   --only <a,b,c>      zip only: only import these basenames (no extension)
//   --name <text>       single file only: display name (default: derived from filename)
//   --alias <a,b,c>     extra names the icon should also match on
//   --prefix <text>     prepended to every derived display name ("Databricks Lakeflow")
//
// Display names come from the SVG's <title> when it has one, else the filename.
// Names + aliases are written to a meta.json sidecar that build-icon-manifest.mjs reads.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import unzipper from "unzipper";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const VENDOR_ROOT = path.join(ROOT, "client", "public", "icons", "vendor");

const IMAGE_EXT = /\.(svg|png)$/i;

function parseArgs(argv) {
  const opts = { alias: [], only: null };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--vendor") opts.vendor = argv[++i];
    else if (a === "--dir") opts.dir = argv[++i];
    else if (a === "--only") opts.only = argv[++i].split(",").map((s) => s.trim());
    else if (a === "--name") opts.name = argv[++i];
    else if (a === "--prefix") opts.prefix = argv[++i];
    else if (a === "--alias") opts.alias = argv[++i].split(",").map((s) => s.trim()).filter(Boolean);
    else rest.push(a);
  }
  opts.source = rest[0];
  return opts;
}

function slugify(name) {
  return name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function titleCase(slug) {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Vendor SVGs usually carry the official product name in <title>, which beats
 * anything guessable from the filename ("ai-bi" -> "AI/BI Dashboards"). */
function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'");
}

function nameFromSvg(buffer) {
  const head = buffer.toString("utf-8", 0, 2000);
  const title = head.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (title) return decodeEntities(title[1]).trim();
  const label = head.match(/aria-label="([^"]+)"/i);
  return label ? decodeEntities(label[1]).trim() : null;
}

function displayName(filename, buffer, opts) {
  if (opts.name) return opts.name;
  const base = path.basename(filename).replace(IMAGE_EXT, "");
  const derived = (filename.toLowerCase().endsWith(".svg") && nameFromSvg(buffer)) || titleCase(base);
  return opts.prefix && !derived.toLowerCase().startsWith(opts.prefix.toLowerCase())
    ? `${opts.prefix} ${derived}`
    : derived;
}

async function collect(opts) {
  const src = path.resolve(opts.source);
  if (src.toLowerCase().endsWith(".zip")) {
    const directory = await unzipper.Open.file(src);
    const out = [];
    for (const entry of directory.files) {
      if (entry.type !== "File" || !IMAGE_EXT.test(entry.path)) continue;
      if (opts.dir && !entry.path.startsWith(opts.dir)) continue;
      const base = path.basename(entry.path).replace(IMAGE_EXT, "");
      if (opts.only && !opts.only.includes(base)) continue;
      out.push({ filename: path.basename(entry.path), buffer: await entry.buffer() });
    }
    return out;
  }
  return [{ filename: path.basename(src), buffer: await fs.readFile(src) }];
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.vendor || !opts.source) {
    console.error("Usage: node scripts/import-vendor-icons.mjs --vendor <slug> [--dir p] [--only a,b] [--name n] [--alias a,b] <zip-or-image>");
    process.exit(1);
  }

  const vendor = slugify(opts.vendor);
  const destDir = path.join(VENDOR_ROOT, vendor);
  await fs.mkdir(destDir, { recursive: true });

  const metaPath = path.join(destDir, "meta.json");
  const meta = await fs
    .readFile(metaPath, "utf-8")
    .then(JSON.parse)
    .catch(() => ({ vendor, label: opts.vendor, icons: {} }));

  const files = await collect(opts);
  for (const { filename, buffer } of files) {
    const ext = path.extname(filename).toLowerCase();
    const name = displayName(filename, buffer, opts);
    const outName = `${slugify(name)}${ext}`;
    await fs.writeFile(path.join(destDir, outName), buffer);
    meta.icons[outName] = { name, aliases: opts.alias };
  }

  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2));
  console.log(`Imported ${files.length} icon(s) into ${destDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

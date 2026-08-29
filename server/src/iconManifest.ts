import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fuse from "fuse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface IconEntry {
  id: string;
  name: string;
  category: string;
  /** "azure" for the official Microsoft pack, else the vendor slug (databricks, sap, ...). */
  vendor: string;
  path: string;
  /** Extra names this icon should also answer to, e.g. "SAP ERP" -> the SAP logo. */
  aliases: string[];
}

const manifestPath = path.join(__dirname, "data", "icon-manifest.json");
const rawManifest: IconEntry[] = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

export const iconManifest: IconEntry[] = rawManifest.map((entry) => ({
  ...entry,
  vendor: entry.vendor ?? "azure",
  aliases: entry.aliases ?? [],
}));

const fuse = new Fuse(iconManifest, {
  keys: [
    { name: "name", weight: 1 },
    { name: "aliases", weight: 0.9 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
  includeScore: true,
});

const FALLBACK_NAME = "Cubes";
const fallbackIcon =
  iconManifest.find((i) => i.name === FALLBACK_NAME) ?? iconManifest[0];

function normalize(q: string): string {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Exact (normalized) name/alias lookup, which is what makes short vendor names work:
 * "SAP" fuzzy-matches half a dozen Azure-for-SAP services, but exactly matches one logo.
 * Azure wins a collision so adding vendor packs can never re-point an existing Azure name. */
const exactIndex = new Map<string, IconEntry>();
for (const entry of iconManifest) {
  for (const label of [entry.name, ...entry.aliases]) {
    const key = normalize(label);
    if (!key) continue;
    const existing = exactIndex.get(key);
    if (!existing || (existing.vendor !== "azure" && entry.vendor === "azure")) {
      exactIndex.set(key, entry);
    }
  }
}

function stripAzurePrefix(q: string): string {
  return q.replace(/^(microsoft|azure)\s+/i, "").trim();
}

/** Resolves a plain-English service name ("Snowflake", "Azure Data Factory", "SAP ERP")
 * to a real icon file - exact name/alias first, then fuzzy. Falls back to a generic
 * "service" icon when nothing matches well. */
export function resolveIcon(serviceName: string): IconEntry {
  const candidates = [serviceName, stripAzurePrefix(serviceName)];

  for (const q of candidates) {
    const hit = exactIndex.get(normalize(q));
    if (hit) return hit;
  }

  let best: { entry: IconEntry; score: number } | null = null;
  for (const q of candidates) {
    if (!q) continue;
    for (const result of fuse.search(q, { limit: 10 })) {
      const score = result.score ?? 1;
      if (!best) {
        best = { entry: result.item, score };
        continue;
      }
      // A near-tie goes to the Azure pack: this is an Azure-first tool, and generic
      // vendor names ("Marketplace", "Workspace") would otherwise steal Azure matches.
      const better = score < best.score - 0.02;
      const tieBreak =
        score < best.score + 0.02 &&
        result.item.vendor === "azure" &&
        best.entry.vendor !== "azure";
      if (better || tieBreak) best = { entry: result.item, score };
    }
  }

  if (best && best.score <= 0.45) return best.entry;
  return fallbackIcon;
}

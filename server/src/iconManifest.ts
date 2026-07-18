import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fuse from "fuse.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface IconEntry {
  id: string;
  name: string;
  category: string;
  path: string;
}

const manifestPath = path.join(__dirname, "data", "icon-manifest.json");
export const iconManifest: IconEntry[] = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

const fuse = new Fuse(iconManifest, {
  keys: [
    { name: "name", weight: 1 },
  ],
  threshold: 0.4,
  ignoreLocation: true,
  includeScore: true,
});

const FALLBACK_NAME = "Cubes";
const fallbackIcon =
  iconManifest.find((i) => i.name === FALLBACK_NAME) ?? iconManifest[0];

function stripAzurePrefix(q: string): string {
  return q.replace(/^azure\s+/i, "").trim();
}

/** Fuzzy-resolves a plain-English Azure service name to a real icon file.
 * Falls back to a generic "service" icon when nothing matches well. */
export function resolveIcon(serviceName: string): IconEntry {
  const candidates = [serviceName, stripAzurePrefix(serviceName)];
  let best: { entry: IconEntry; score: number } | null = null;

  for (const q of candidates) {
    if (!q) continue;
    const results = fuse.search(q, { limit: 1 });
    if (results.length > 0) {
      const score = results[0].score ?? 1;
      if (!best || score < best.score) {
        best = { entry: results[0].item, score };
      }
    }
  }

  if (best && best.score <= 0.45) return best.entry;
  return fallbackIcon;
}

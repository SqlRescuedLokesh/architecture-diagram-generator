# CLAUDE.md

Guidance for Claude Code working in this repo. Keep this file short — it loads into every session.

## What this is

A web app that turns a plain-English prompt into an Azure architecture diagram drawn with the
official Microsoft Azure service icons, exportable as an **editable** PowerPoint (.pptx).

- **`client/`** — Vite + React + TypeScript frontend (the browser UI).
- **`server/`** — Express + TypeScript backend (holds the API key, calls Claude, lays out the diagram).
- One language (TypeScript) across the whole stack.

## Run it

```
npm install
cp server/.env.example server/.env   # then add ANTHROPIC_API_KEY
npm run dev                          # starts BOTH servers concurrently
```

- Server: http://localhost:3001 · Client: http://localhost:5173 (open this one).
- Vite proxies `/api/*` to the backend, so the browser talks to one origin.
- **Only run one editing session at a time.** Two agents editing the same files caused a
  dependency-mismatch crash before (one added a package + committed, the other's running server
  couldn't find it). If you add a dependency, run `npm install` before relying on it.

## The core contract (do not break)

The whole app is a data pipeline with a strict shape at each hop:

1. **Prompt → Claude** (`server/src/claude.ts`): Claude is forced (via a tool call) to emit a
   `DiagramSpec` — lanes, groups, nodes, edges, footers. **Claude names services in plain English
   only** (e.g. "Azure Databricks"), NEVER icon filenames. Every ordered edge must have a `label`
   (these become the numbered "How the data flows" legend). Every node must be reachable by an edge;
   cross-cutting concerns (identity, secrets, monitoring, governance, auditing) go in `footers`, not
   `nodes`, and never as an edge target — a band says "this applies throughout" without an arrow.
   Footers are bands: `position: "top"` puts one above the flow, `"bottom"` (default) below it.
   Groups **cannot nest**; a group owning no nodes is dropped by `sanitizeSpec` (ELK sizes a childless
   compound node as 0×0, which renders as a stray label). Use a lane for an outer container.
2. **Validate** (`server/src/schema.ts`): Zod schema; `DiagramSpec` type is `z.infer`'d from it, so
   schema and type stay in sync. `sanitizeSpec` drops dangling references so a bad model output still renders.
3. **Icon resolution** (`server/src/iconManifest.ts`): fuzzy-matches each plain-English service name
   against `server/src/data/icon-manifest.json` (all 705 official icons). No Azure match → generic fallback icon.
4. **Layout** (`server/src/layout.ts`): elkjs computes coordinates → returns a render-ready
   `RenderDiagram` (absolute x/y/w/h for everything). The frontend does **no** layout math — it just draws.
5. **Render** (`client/src/components/DiagramCanvas.tsx`): draws the `RenderDiagram` as live SVG.
6. **Export** (`client/src/lib/export.ts`): rebuilds the diagram as native PowerPoint shapes from the
   same `RenderDiagram` (so the .pptx is editable, not a flattened image).

If you add a field to `RenderDiagram` on the server, add it to `client/src/types/diagram.ts` too — the
compiler will catch the mismatch if you run `npx tsc --noEmit`.

A node can carry an optional **`badge`**: a second service name, resolved to `badgeIconPath` and drawn
as a small icon on the top-right corner of the node's icon over a white disc. It exists for "X stored
on Y" nodes where one icon can't say both things — Delta tables whose storage is ADLS Gen2 are
`service: "Azure Data Lake Storage Gen2"` + `badge: "Delta Lake"`.

Lanes and groups take a **`badge`** too, drawn in the container's header opposite the name, for a
capability governing everything inside the box — a "Lakehouse" lane badged with "Unity Catalog" says
the data in it is Unity Catalog onboarded. Like the top capability bands, a container badge never
takes an arrow. In `export.ts` the header label's width is reduced by the badge zone, or a long lane
name runs underneath the icon (PowerPoint does not clip overflowing text).

`BADGE_SCALE`/`BADGE_HALO`/`HEADER_BADGE_SCALE` are duplicated in `DiagramCanvas.tsx` and `export.ts`
and must stay in lockstep or the deck stops matching the preview.

## Layout gotchas (hard-won — read before touching `layout.ts`)

- **Lanes are bounding boxes computed AFTER layout**, not elk containers. Making each lane its own elk
  container lets lanes float to independent vertical offsets (staggered look). Keep lanes as
  post-hoc bounding boxes around their member nodes/groups.
- **Those lane boxes are then normalised to a shared top and bottom** so the diagram reads as aligned
  columns. Only the lane *rectangles* move — never the nodes, whose ELK coordinates the edge routes
  depend on. (Raw boxes varied 4.1× in height at unrelated offsets and covered 23% of the canvas.)
- **Node placement is deliberately `SIMPLE`.** ELK's default (`BRANDES_KOEPF`) balances nodes across the
  full height of their layer, which strands every lane half-empty and staggers content vertically.
  `SIMPLE` packs each layer from the top: canvas height 1610→852, node density 3.9%→7.4% on a 9-lane
  spec, no new overlaps. Small diagrams lay out identically either way.
- **Groups ARE elk compound nodes** (nested containers) — that's what guarantees sibling groups don't overlap.
- **Groups don't inherit root spacing** in elkjs — set `elk.spacing.nodeNode` /
  `elk.layered.spacing.nodeNodeBetweenLayers` explicitly on each group, or nodes inside a group cram together.
- **Declare each edge in its lowest-common-ancestor container** (the shared group, or root). An edge
  between two nodes in the same group, if declared at root, routes to a degenerate ~zero-length segment.
- **Lane order is a hard constraint on edge direction.** ELK partitions nodes by lane index, so an
  edge running from a later lane back into an earlier one is drawn as a literally reversed arrow and
  drags the nodes around it out of order (a "Transformation" lane placed after a Bronze/Silver/Gold
  group inverted two arrows and rendered the medallion as Gold/Bronze/Silver). `sanitizeSpec` now
  moves a loose node whose upstream *and* downstream neighbours all sit in one lane into that lane
  (and their group, if shared); grouped nodes are never moved. If a reversing edge survives that,
  `layout.ts` drops `elk.partitioning.activate` - ragged lane boxes beat backwards arrows.
- After any layout change, re-run several varied prompts and check for overlaps and short edges before trusting it.

## Export gotchas (hard-won — read before touching `export.ts`)

- **The slide is sized to the diagram, not the reverse.** Rendering at a fixed legible scale
  (one node ≈ 1.15in) and growing the slide — up to PowerPoint's hard 56in limit — is what keeps big
  diagrams readable. Fitting a large diagram onto a fixed 13.33×7.5in slide gives ~0.5in nodes.
- **Nothing may be a fixed inch value.** Icons, captions, badges and gaps all derive from the scale, and
  every label is auto-shrunk to fit its box (5pt floor). PowerPoint does **not** clip overflowing text —
  it spills across neighbouring shapes, which is what "jumbled icons" bug reports actually are.
- **A negative width/height makes PowerPoint refuse to open the file** ("can't read...", no repair
  prompt) — clamp anything computed as `px(w) - padding`.
- **One `bentConnector3` per edge**, not a shape per routed segment: a single shape with endpoint
  handles plus the yellow bend handle is what makes an arrow movable (172 line shapes → 17). The empty
  `<a:avLst/>` leaves the bend at its 50% default. `DiagramCanvas` draws the same elbow so the preview
  matches the download — change both together.

## Conventions

- Model is configurable: `ANTHROPIC_MODEL` env var, default in `server/src/claude.ts`.
- Type-check with `npx tsc --noEmit` (per workspace) before running; it catches contract mismatches early.
- Icons live in two roots under `client/public/icons/`:
  - `azure/<category>/` — the official Microsoft pack. Re-import with `npm run import-icons -- <zip>`
    (this **wipes** the azure root, which is why vendor icons live elsewhere).
  - `vendor/<vendor>/` — non-Azure packs (Databricks, Snowflake, SAP, Power BI). Add one with
    `npm run import-vendor-icons -- --vendor <slug> [--dir <zip-subpath>] [--only a,b] [--name "X"] [--alias "a,b"] <zip-or-image>`.
    Display names come from the SVG's `<title>`; names + aliases are written to a `meta.json`
    sidecar in the vendor folder, which the manifest build reads back.
  Either way, finish with `npm run build-icon-manifest` to regenerate
  `server/src/data/icon-manifest.json`. Both `.svg` and `.png` sources work.
- **Short or vendor names need exact matching, not fuzzy.** `resolveIcon` checks a normalized
  name/alias index before falling back to Fuse; without it "SAP" fuzzy-matches half a dozen
  Azure-for-SAP services and "Snowflake" matches nothing at all. Azure wins any exact-key or
  near-tie collision, so adding a vendor pack can never re-point an existing Azure name.
- **`scripts/icon-aliases.json` covers services the pack names differently or not at all**
  (Microsoft Purview, Azure Functions, Azure Blob Storage, Entra ID). Add an entry there rather
  than loosening the fuzzy threshold — a looser threshold silently re-points other names.
- **A vendor icon can supersede a stale pack icon**: the Azure pack's only Data Lake Storage icon
  is the Gen1 mark, so the current ADLS Gen2 icon lives in `vendor/microsoft/` and owns the
  "Azure Data Lake Storage"/"ADLS" names via its aliases. Same pattern for any icon Microsoft
  refreshes faster than the pack.
- **Keep aliases specific.** A generic alias steals unrelated names through the fuzzy pass —
  "Azure Data Lake" on the ADLS icon out-scored "Data Factories" for the query "Azure Data
  Factory". After editing aliases, re-resolve a spread of Azure names and check nothing moved.
- **Never put the API key in client code or in chat** — it lives only in `server/.env` (gitignored).

## Public-facing hardening (already in place)

- Per-IP rate limit on `/api/generate` (`server/src/routes/generate.ts`).
- Monthly cost/budget cap (`server/src/usageTracker.ts`, `/api/usage`) — returns 429 when the API
  budget is exhausted. Budget configured via `MONTHLY_BUDGET_USD` / `FIXED_MONTHLY_COST_USD` env vars.
- **Usage counters accumulate in a JSON file and are only as durable as that file.** It defaults to
  `data/usage.json` beside the running code, so dev (`src/`) and a build (`dist/`) keep separate
  tallies and an ephemeral host resets to zero each deploy — set `USAGE_FILE_PATH` to a mounted
  volume in production. Writes are temp-file-then-rename (a truncated file reads as "no history" and
  zeroes the site's all-time figures); an unparseable file is renamed `.corrupt-<ts>` rather than
  overwritten. `copyAssets.mjs` deliberately skips `usage.json` so a rebuild can't clobber it.
- **Cost is priced at record time, per model, and never recomputed.** `recordUsage` stores dollars
  alongside tokens in a per-model and a per-month bucket, so changing `ANTHROPIC_MODEL` can't
  retroactively rewrite past spend. Add new model ids to `PRICING_PER_MILLION_TOKENS` (exact ids,
  no date suffixes) — an unlisted model silently falls back to Sonnet 4.6 pricing. Files written
  before this existed are migrated on load by pricing their history at the configured model, which
  reproduces the figure they used to report.
- Optional "Support this website" button wired to a Razorpay link via `VITE_RAZORPAY_PAYMENT_LINK`.
- In production the server also serves the built client from `client/dist` (single deploy); in dev
  that's skipped and Vite serves the frontend.

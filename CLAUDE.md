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
- Icons live in `client/public/icons/azure/<category>/`. Re-import from a new pack with
  `npm run import-icons -- <zip>` then `npm run build-icon-manifest`.
- **Never put the API key in client code or in chat** — it lives only in `server/.env` (gitignored).

## Public-facing hardening (already in place)

- Per-IP rate limit on `/api/generate` (`server/src/routes/generate.ts`).
- Monthly cost/budget cap (`server/src/usageTracker.ts`, `/api/usage`) — returns 429 when the API
  budget is exhausted. Budget configured via `MONTHLY_BUDGET_USD` / `FIXED_MONTHLY_COST_USD` env vars.
- Optional "Support this website" button wired to a Razorpay link via `VITE_RAZORPAY_PAYMENT_LINK`.
- In production the server also serves the built client from `client/dist` (single deploy); in dev
  that's skipped and Vite serves the frontend.

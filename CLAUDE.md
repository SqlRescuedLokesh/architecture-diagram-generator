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
   cross-cutting concerns (identity, secrets, monitoring, governance) go in `footers`, not `nodes`.
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
- **Groups ARE elk compound nodes** (nested containers) — that's what guarantees sibling groups don't overlap.
- **Groups don't inherit root spacing** in elkjs — set `elk.spacing.nodeNode` /
  `elk.layered.spacing.nodeNodeBetweenLayers` explicitly on each group, or nodes inside a group cram together.
- **Declare each edge in its lowest-common-ancestor container** (the shared group, or root). An edge
  between two nodes in the same group, if declared at root, routes to a degenerate ~zero-length segment.
- After any layout change, re-run several varied prompts and check for overlaps and short edges before trusting it.

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

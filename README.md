# Azure Architecture Diagram Generator

Turn a plain-English prompt into an Azure reference-architecture diagram, drawn with the official Microsoft Azure service icons.

## How it works

1. You type a description of a system (e.g. "Event Hubs feeding Databricks, writing Delta Lake bronze/silver/gold, served via Power BI").
2. The server sends the prompt to Claude, which returns a structured diagram spec (lanes, groups, nodes, edges, footer bands) — never icon filenames, just plain-English Azure service names.
3. The server fuzzy-matches each service name against a manifest of all 705 official Azure icons and resolves the real SVG file.
4. [elkjs](https://github.com/kieler/elkjs) lays out the graph (grouped into lanes/boxes, with routed arrows); the result is sent to the browser as ready-to-draw coordinates.
5. The client renders it as a live SVG, exportable as a PowerPoint (.pptx) slide via [pptxgenjs](https://github.com/gitbrent/PptxGenJS) (the diagram is rasterized to a PNG and placed on a single widescreen slide with the title).

## Setup

```
npm install
cp server/.env.example server/.env
# edit server/.env and add your ANTHROPIC_API_KEY
npm run dev
```

This starts the API server on `http://localhost:3001` and the web app on `http://localhost:5173` (open this one in your browser). The Vite dev server proxies `/api/*` to the backend.

## Re-importing icons

The icon set is already extracted into `client/public/icons/azure`. If Microsoft ships a newer icon pack zip, re-import it with:

```
npm run import-icons -- "/path/to/Azure_Public_Service_Icons_VXX.zip"
npm run build-icon-manifest
```

## Notes / limitations

- Only official Azure service icons are used for matching. Prompts that mention non-Azure technologies commonly paired with Azure (Apache Spark, Delta Lake, MLflow, Kubernetes workloads, etc.) will still render but fall back to a generic icon since no official Azure icon exists for them.
- Layout is automatic (not a pixel-exact copy of any specific Microsoft reference diagram) — it generalizes to arbitrary architectures, not just data-lakehouse examples.

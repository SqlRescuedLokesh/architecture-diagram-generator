import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { generateRouter } from "./routes/generate.js";
import { usageRouter } from "./routes/usage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// In production this server also hosts the built client (single deploy).
// In local dev, client/dist won't exist yet since Vite's own dev server on
// :5173 handles the frontend instead — so this is skipped automatically.
const clientDistPath = path.join(__dirname, "..", "..", "client", "dist");
const hasClientBuild = fs.existsSync(path.join(clientDistPath, "index.html"));

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use("/api", generateRouter);
app.use("/api", usageRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

if (hasClientBuild) {
  app.use(express.static(clientDistPath));
  // SPA fallback: any non-API route serves the client so client-side
  // routing/deep links still work.
  app.use((req, res, next) => {
    if (req.path.startsWith("/api")) return next();
    res.sendFile(path.join(clientDistPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Azure diagram server listening on http://localhost:${PORT}`);
  if (!hasClientBuild) {
    console.log("(No client/dist found — run `npm run build -w client` to serve the frontend too.)");
  }
});

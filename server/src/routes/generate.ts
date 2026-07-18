import { Router } from "express";
import rateLimit from "express-rate-limit";
import { generateDiagramSpec } from "../claude.js";
import { sanitizeSpec } from "../schema.js";
import { layoutDiagram } from "../layout.js";
import { isBudgetExceeded } from "../usageTracker.js";

export const generateRouter = Router();

// Caps a single visitor to 15 generations/hour so one visitor can't burn
// through the whole monthly API budget in minutes.
const generateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many diagrams generated from this IP. Try again in a bit." },
});

generateRouter.post("/generate", generateLimiter, async (req, res) => {
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!prompt) {
    res.status(400).json({ error: "Missing 'prompt' in request body." });
    return;
  }

  if (isBudgetExceeded()) {
    res.status(429).json({
      error:
        "This site's monthly API budget has been reached. Diagram generation resets on the 1st of next month.",
    });
    return;
  }

  try {
    const rawSpec = await generateDiagramSpec(prompt);
    const { spec } = sanitizeSpec(rawSpec);
    const diagram = await layoutDiagram(spec);
    res.json(diagram);
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : "Unknown error generating diagram.";
    res.status(500).json({ error: message });
  }
});

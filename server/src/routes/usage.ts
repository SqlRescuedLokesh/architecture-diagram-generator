import { Router } from "express";
import { getUsageStats } from "../usageTracker.js";

export const usageRouter = Router();

usageRouter.get("/usage", (_req, res) => {
  res.json(getUsageStats());
});

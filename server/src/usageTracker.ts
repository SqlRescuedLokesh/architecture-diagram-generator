import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const usageFilePath = path.join(__dirname, "data", "usage.json");

/** USD price per 1M tokens, input/output. Extend as new models are used. */
const PRICING_PER_MILLION_TOKENS: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-haiku-4-5-20251001": { input: 1, output: 5 },
};

// Fallback if the configured model isn't in the table above.
const DEFAULT_PRICING = { input: 3, output: 15 };

// Overall monthly budget for the whole site (hosting/domain + Claude API).
// FIXED_MONTHLY_COST_USD should reflect your actual hosting+domain spend so
// the remaining amount is what's left for Claude API calls.
const MONTHLY_BUDGET_USD = Number(process.env.MONTHLY_BUDGET_USD) || 20;
const FIXED_MONTHLY_COST_USD = Number(process.env.FIXED_MONTHLY_COST_USD) || 7;
const API_BUDGET_USD = Math.max(MONTHLY_BUDGET_USD - FIXED_MONTHLY_COST_USD, 0);

interface MonthBucket {
  requests: number;
  inputTokens: number;
  outputTokens: number;
}

interface UsageState {
  since: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  /** Keyed by "YYYY-MM", resets naturally as new months are recorded. */
  months: Record<string, MonthBucket>;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function emptyState(): UsageState {
  return {
    since: new Date().toISOString(),
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    months: {},
  };
}

function loadState(): UsageState {
  try {
    const raw = fs.readFileSync(usageFilePath, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      since: typeof parsed.since === "string" ? parsed.since : new Date().toISOString(),
      totalRequests: Number(parsed.totalRequests) || 0,
      totalInputTokens: Number(parsed.totalInputTokens) || 0,
      totalOutputTokens: Number(parsed.totalOutputTokens) || 0,
      months: typeof parsed.months === "object" && parsed.months !== null ? parsed.months : {},
    };
  } catch {
    return emptyState();
  }
}

let state = loadState();

function persist() {
  try {
    fs.mkdirSync(path.dirname(usageFilePath), { recursive: true });
    fs.writeFileSync(usageFilePath, JSON.stringify(state, null, 2));
  } catch (err) {
    console.error("Failed to persist usage stats:", err);
  }
}

function pricingFor(model: string) {
  return PRICING_PER_MILLION_TOKENS[model] ?? DEFAULT_PRICING;
}

function costUsd(inputTokens: number, outputTokens: number, pricing: { input: number; output: number }) {
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

/** Record token usage from one Claude API response. Call this on every
 * attempt (including retries) since every attempt is billed. */
export function recordUsage(model: string, inputTokens: number, outputTokens: number) {
  state.totalRequests += 1;
  state.totalInputTokens += inputTokens;
  state.totalOutputTokens += outputTokens;

  const key = currentMonthKey();
  const bucket = state.months[key] ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
  bucket.requests += 1;
  bucket.inputTokens += inputTokens;
  bucket.outputTokens += outputTokens;
  state.months[key] = bucket;

  persist();
}

/** Estimated Claude API spend so far this calendar month. */
export function getMonthToDateCostUsd(): number {
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const pricing = pricingFor(model);
  const bucket = state.months[currentMonthKey()] ?? { requests: 0, inputTokens: 0, outputTokens: 0 };
  return costUsd(bucket.inputTokens, bucket.outputTokens, pricing);
}

/** Whether this month's Claude API spend has hit the portion of the budget
 * left over after fixed hosting/domain costs. */
export function isBudgetExceeded(): boolean {
  return getMonthToDateCostUsd() >= API_BUDGET_USD;
}

export function getUsageStats() {
  // Reported cost uses whichever model is currently configured; if the app
  // has switched models mid-history this is an approximation, not exact.
  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";
  const pricing = pricingFor(model);
  const estimatedCostUsd = costUsd(state.totalInputTokens, state.totalOutputTokens, pricing);
  const monthToDateCostUsd = getMonthToDateCostUsd();
  const monthBucket = state.months[currentMonthKey()] ?? { requests: 0, inputTokens: 0, outputTokens: 0 };

  return {
    model,
    since: state.since,
    totalRequests: state.totalRequests,
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
    pricePerMillionTokens: pricing,
    estimatedCostUsd: Math.round(estimatedCostUsd * 10000) / 10000,
    budget: {
      monthlyBudgetUsd: MONTHLY_BUDGET_USD,
      fixedMonthlyCostUsd: FIXED_MONTHLY_COST_USD,
      apiBudgetUsd: API_BUDGET_USD,
      monthRequests: monthBucket.requests,
      monthToDateCostUsd: Math.round(monthToDateCostUsd * 10000) / 10000,
      remainingUsd: Math.round(Math.max(API_BUDGET_USD - monthToDateCostUsd, 0) * 10000) / 10000,
      isOverBudget: monthToDateCostUsd >= API_BUDGET_USD,
    },
  };
}

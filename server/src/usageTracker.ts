import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Where the running server accumulates its counters. Defaults to a file next
// to the code, which means dev (src/data) and a compiled build (dist/data)
// keep separate tallies — and on a host with an ephemeral filesystem the
// tally restarts at zero on every deploy. Point USAGE_FILE_PATH at a mounted
// volume in production to keep one continuous history.
const usageFilePath = process.env.USAGE_FILE_PATH
  ? path.resolve(process.env.USAGE_FILE_PATH)
  : path.join(__dirname, "data", "usage.json");

interface Pricing {
  input: number;
  output: number;
}

/** USD price per 1M tokens, input/output. Extend as new models are used. */
const PRICING_PER_MILLION_TOKENS: Record<string, Pricing> = {
  "claude-fable-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25 },
  "claude-opus-4-8": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

// Fallback if the configured model isn't in the table above.
const DEFAULT_PRICING: Pricing = { input: 3, output: 15 };

const DEFAULT_MODEL = "claude-sonnet-4-6";

// Overall monthly budget for the whole site (hosting/domain + Claude API).
// FIXED_MONTHLY_COST_USD should reflect your actual hosting+domain spend so
// the remaining amount is what's left for Claude API calls.
const MONTHLY_BUDGET_USD = Number(process.env.MONTHLY_BUDGET_USD) || 20;
const FIXED_MONTHLY_COST_USD = Number(process.env.FIXED_MONTHLY_COST_USD) || 7;
const API_BUDGET_USD = Math.max(MONTHLY_BUDGET_USD - FIXED_MONTHLY_COST_USD, 0);

/** Tokens and the dollars they actually cost, frozen at the moment they were
 * recorded. Used for both the per-month and the per-model tallies. */
interface Bucket {
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

interface UsageState {
  since: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  /** Keyed by model id, so switching models never rewrites past spend. */
  models: Record<string, Bucket>;
  /** Keyed by "YYYY-MM", resets naturally as new months are recorded. */
  months: Record<string, Bucket>;
}

function configuredModel(): string {
  return process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function emptyBucket(): Bucket {
  return { requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

function emptyState(): UsageState {
  return {
    since: new Date().toISOString(),
    totalRequests: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    models: {},
    months: {},
  };
}

function pricingFor(model: string): Pricing {
  return PRICING_PER_MILLION_TOKENS[model] ?? DEFAULT_PRICING;
}

function costUsd(inputTokens: number, outputTokens: number, pricing: Pricing): number {
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/** Coerce one bucket read off disk. `costUsd` is absent in files written
 * before per-model pricing existed — back-fill it at the configured model's
 * price, which is exactly the number those files used to report. From then on
 * the stored figure is authoritative and is never recomputed. */
function readBucket(raw: unknown, backfillPricing: Pricing): Bucket {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const inputTokens = Number(source.inputTokens) || 0;
  const outputTokens = Number(source.outputTokens) || 0;
  return {
    requests: Number(source.requests) || 0,
    inputTokens,
    outputTokens,
    costUsd:
      typeof source.costUsd === "number" && Number.isFinite(source.costUsd)
        ? source.costUsd
        : costUsd(inputTokens, outputTokens, backfillPricing),
  };
}

function readBuckets(raw: unknown, backfillPricing: Pricing): Record<string, Bucket> {
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, Bucket> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    out[key] = readBucket(value, backfillPricing);
  }
  return out;
}

function loadState(): UsageState {
  let raw: string;
  try {
    raw = fs.readFileSync(usageFilePath, "utf-8");
  } catch {
    // No file yet: first run, or a fresh deploy. Start from zero.
    return emptyState();
  }

  try {
    const parsed = JSON.parse(raw);
    // Best guess for history recorded before costs were stored: it was all
    // billed at whatever model is configured now — which is exactly what the
    // old all-time figure assumed.
    const legacyModel = configuredModel();
    const legacyPricing = pricingFor(legacyModel);

    const totalRequests = Number(parsed.totalRequests) || 0;
    const totalInputTokens = Number(parsed.totalInputTokens) || 0;
    const totalOutputTokens = Number(parsed.totalOutputTokens) || 0;
    const months = readBuckets(parsed.months, legacyPricing);

    let models = readBuckets(parsed.models, legacyPricing);
    if (Object.keys(models).length === 0 && (totalInputTokens > 0 || totalOutputTokens > 0)) {
      models = {
        [legacyModel]: {
          requests: totalRequests,
          inputTokens: totalInputTokens,
          outputTokens: totalOutputTokens,
          costUsd: costUsd(totalInputTokens, totalOutputTokens, legacyPricing),
        },
      };
    }

    return {
      since: typeof parsed.since === "string" ? parsed.since : new Date().toISOString(),
      totalRequests,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd:
        typeof parsed.totalCostUsd === "number" && Number.isFinite(parsed.totalCostUsd)
          ? parsed.totalCostUsd
          : costUsd(totalInputTokens, totalOutputTokens, legacyPricing),
      models,
      months,
    };
  } catch {
    // The file exists but doesn't parse — a partial write from a crash, say.
    // Move it aside so the next persist() doesn't overwrite the only copy of
    // the history. Counters restart at zero either way, but the damaged file
    // is still on disk to hand-repair.
    const quarantinePath = `${usageFilePath}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(usageFilePath, quarantinePath);
      console.error(
        `Usage stats file was unreadable; moved it to ${quarantinePath} and restarted counters at zero.`,
      );
    } catch (err) {
      console.error("Usage stats file was unreadable and could not be moved aside:", err);
    }
    return emptyState();
  }
}

let state = loadState();

function persist() {
  const tmpPath = `${usageFilePath}.tmp`;
  try {
    fs.mkdirSync(path.dirname(usageFilePath), { recursive: true });
    // Write-then-rename, because rename is atomic: a crash mid-write leaves
    // the previous good file untouched rather than a truncated one, which
    // loadState can only read as "no history".
    fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
    fs.renameSync(tmpPath, usageFilePath);
  } catch (err) {
    console.error("Failed to persist usage stats:", err);
    try {
      fs.rmSync(tmpPath, { force: true });
    } catch {
      // Nothing more to do; the next persist() overwrites the temp file anyway.
    }
  }
}

function addToBucket(
  buckets: Record<string, Bucket>,
  key: string,
  entry: { inputTokens: number; outputTokens: number; costUsd: number },
) {
  const bucket = buckets[key] ?? emptyBucket();
  bucket.requests += 1;
  bucket.inputTokens += entry.inputTokens;
  bucket.outputTokens += entry.outputTokens;
  bucket.costUsd += entry.costUsd;
  buckets[key] = bucket;
}

/** Record token usage from one Claude API response. Call this on every
 * attempt (including retries) since every attempt is billed. */
export function recordUsage(model: string, inputTokens: number, outputTokens: number) {
  // Price the call now, at the model that actually served it. Storing the
  // dollars (not just the tokens) is what keeps history correct when
  // ANTHROPIC_MODEL later changes to a differently-priced model.
  const spend = costUsd(inputTokens, outputTokens, pricingFor(model));
  const entry = { inputTokens, outputTokens, costUsd: spend };

  state.totalRequests += 1;
  state.totalInputTokens += inputTokens;
  state.totalOutputTokens += outputTokens;
  state.totalCostUsd += spend;

  addToBucket(state.models, model, entry);
  addToBucket(state.months, currentMonthKey(), entry);

  persist();
}

/** Estimated Claude API spend so far this calendar month. */
export function getMonthToDateCostUsd(): number {
  return state.months[currentMonthKey()]?.costUsd ?? 0;
}

/** Whether this month's Claude API spend has hit the portion of the budget
 * left over after fixed hosting/domain costs. */
export function isBudgetExceeded(): boolean {
  return getMonthToDateCostUsd() >= API_BUDGET_USD;
}

export function getUsageStats() {
  const model = configuredModel();
  const monthToDateCostUsd = getMonthToDateCostUsd();
  const monthBucket = state.months[currentMonthKey()] ?? emptyBucket();

  // Each model's spend is the sum of what its own calls cost when they were
  // made, so the all-time total stays accurate across model switches.
  const models = Object.entries(state.models)
    .map(([id, bucket]) => ({
      model: id,
      requests: bucket.requests,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      costUsd: round4(bucket.costUsd),
    }))
    .sort((a, b) => b.costUsd - a.costUsd);

  return {
    model,
    since: state.since,
    totalRequests: state.totalRequests,
    totalInputTokens: state.totalInputTokens,
    totalOutputTokens: state.totalOutputTokens,
    pricePerMillionTokens: pricingFor(model),
    estimatedCostUsd: round4(state.totalCostUsd),
    models,
    budget: {
      monthlyBudgetUsd: MONTHLY_BUDGET_USD,
      fixedMonthlyCostUsd: FIXED_MONTHLY_COST_USD,
      apiBudgetUsd: API_BUDGET_USD,
      monthRequests: monthBucket.requests,
      monthToDateCostUsd: round4(monthToDateCostUsd),
      remainingUsd: round4(Math.max(API_BUDGET_USD - monthToDateCostUsd, 0)),
      isOverBudget: monthToDateCostUsd >= API_BUDGET_USD,
    },
  };
}

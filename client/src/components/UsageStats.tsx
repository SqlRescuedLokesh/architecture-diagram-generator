import { useEffect, useState } from "react";

interface UsageData {
  model: string;
  since: string;
  totalRequests: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  pricePerMillionTokens: { input: number; output: number };
  estimatedCostUsd: number;
  budget: {
    monthlyBudgetUsd: number;
    fixedMonthlyCostUsd: number;
    apiBudgetUsd: number;
    monthRequests: number;
    monthToDateCostUsd: number;
    remainingUsd: number;
    isOverBudget: boolean;
  };
}

const REFRESH_INTERVAL_MS = 30_000;

function formatTokens(n: number): string {
  return n.toLocaleString("en-US");
}

function formatCost(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}`;
}

export function UsageStats() {
  const [data, setData] = useState<UsageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const res = await fetch("/api/usage");
        if (!res.ok) throw new Error(`Request failed with status ${res.status}`);
        const json: UsageData = await res.json();
        if (!cancelled) {
          setData(json);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load usage stats.");
        }
      }
    }

    load();
    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  if (error) {
    return (
      <section className="usage-stats usage-stats-error">
        Usage stats unavailable: {error}
      </section>
    );
  }

  if (!data) {
    return <section className="usage-stats">Loading usage stats…</section>;
  }

  const since = new Date(data.since).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

  const { budget } = data;
  const budgetPct = budget.apiBudgetUsd > 0
    ? Math.min((budget.monthToDateCostUsd / budget.apiBudgetUsd) * 100, 100)
    : 100;

  return (
    <section className="usage-stats">
      <h2>API usage &amp; estimated cost</h2>
      <div className="usage-stats-grid">
        <div className="usage-stat">
          <span className="usage-stat-label">Diagrams generated</span>
          <span className="usage-stat-value">{formatTokens(data.totalRequests)}</span>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-label">Input tokens</span>
          <span className="usage-stat-value">{formatTokens(data.totalInputTokens)}</span>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-label">Output tokens</span>
          <span className="usage-stat-value">{formatTokens(data.totalOutputTokens)}</span>
        </div>
        <div className="usage-stat">
          <span className="usage-stat-label">Estimated Anthropic API cost (all-time)</span>
          <span className="usage-stat-value">{formatCost(data.estimatedCostUsd)}</span>
        </div>
      </div>

      <div className="usage-budget">
        <div className="usage-budget-header">
          <span>This month's API budget</span>
          <span>
            {formatCost(budget.monthToDateCostUsd)} / {formatCost(budget.apiBudgetUsd)}
          </span>
        </div>
        <div className="usage-budget-bar">
          <div
            className={`usage-budget-bar-fill${budget.isOverBudget ? " over" : ""}`}
            style={{ width: `${budgetPct}%` }}
          />
        </div>
        {budget.isOverBudget ? (
          <p className="usage-budget-note over">
            Monthly budget reached — diagram generation is paused until next month.
          </p>
        ) : (
          <p className="usage-budget-note">
            {formatCost(budget.remainingUsd)} left this month · site budget is $
            {budget.monthlyBudgetUsd}/mo total (${budget.fixedMonthlyCostUsd} hosting + $
            {budget.apiBudgetUsd} API)
          </p>
        )}
      </div>

      <p className="usage-stats-footnote">
        Tracking since {since} · model: {data.model} · priced at ${data.pricePerMillionTokens.input}/M
        input, ${data.pricePerMillionTokens.output}/M output tokens. Figures are estimates based on
        tracked token usage, not a live account balance (Anthropic doesn't expose one via API).
      </p>
    </section>
  );
}

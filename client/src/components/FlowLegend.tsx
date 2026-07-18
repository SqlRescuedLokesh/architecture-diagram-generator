import type { RenderFlowStep } from "../types/diagram";

export function FlowLegend({ steps }: { steps: RenderFlowStep[] }) {
  if (steps.length === 0) return null;

  return (
    <div className="flow-legend">
      <h2>How the data flows</h2>
      <ol>
        {steps.map((step) => (
          <li key={step.order}>
            <span className="flow-legend-badge">{step.order}</span>
            <span>{step.text}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

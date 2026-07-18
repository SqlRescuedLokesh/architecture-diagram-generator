import { useState } from "react";
import "./App.css";
import { DiagramCanvas } from "./components/DiagramCanvas";
import { FlowLegend } from "./components/FlowLegend";
import { Toolbar } from "./components/Toolbar";
import { UsageStats } from "./components/UsageStats";
import { SupportButton } from "./components/SupportButton";
import { downloadPptx } from "./lib/export";
import type { RenderDiagram } from "./types/diagram";

const EXAMPLE_PROMPT =
  "A medallion lakehouse on Azure: Azure Event Hubs and Fabric Data Factory ingest into Azure Data Lake Storage, processed through Bronze, Silver and Gold layers in Delta Lake using Azure Databricks with Spark and MLflow. Gold data is served via Azure Databricks SQL warehouses to Power BI, and via Azure Machine Learning. Add a Store lane below Process. Add footer bands for 'Discover and govern' (Unity Catalog, Azure Purview) and 'Platform' (Microsoft Entra ID, Cost Management, Azure Key Vault, Azure Monitor, Azure DevOps and GitHub).";

function App() {
  const [prompt, setPrompt] = useState(EXAMPLE_PROMPT);
  const [diagram, setDiagram] = useState<RenderDiagram | null>(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(
          body.error || `Request failed with status ${res.status}`,
        );
      }
      const data: RenderDiagram = await res.json();
      setDiagram(data);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to generate diagram.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadPptx() {
    if (!diagram || exporting) return;
    setExporting(true);
    setError(null);
    try {
      await downloadPptx(diagram);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export PPTX.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-row">
          <div>
            <h1>Azure Architecture Diagram Generator</h1>
            <p>
              Describe an Azure architecture in plain English and generate a diagram
              using the official icon set.
            </p>
          </div>
          <SupportButton />
        </div>
      </header>

      <section className="prompt-section">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={5}
          placeholder="Describe your Azure architecture..."
        />
        <div className="prompt-actions">
          <button
            className="generate-btn"
            onClick={handleGenerate}
            disabled={loading}
          >
            {loading ? "Generating…" : "Generate Diagram"}
          </button>
          <Toolbar
            disabled={!diagram || exporting}
            exporting={exporting}
            onDownloadPptx={handleDownloadPptx}
          />
        </div>
        {error && <div className="error">{error}</div>}
      </section>

      <section className="diagram-section">
        {diagram ? (
          <div className="diagram-scroll">
            <DiagramCanvas diagram={diagram} />
          </div>
        ) : (
          <div className="placeholder">
            {loading
              ? "Designing your architecture…"
              : "Your generated diagram will appear here."}
          </div>
        )}
      </section>

      {diagram && <FlowLegend steps={diagram.flowSteps} />}

      <UsageStats />
    </div>
  );
}

export default App;

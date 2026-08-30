import Anthropic from "@anthropic-ai/sdk";
import { DiagramSpecSchema, type DiagramSpec } from "./schema.js";
import { recordUsage } from "./usageTracker.js";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6";

let client: Anthropic | null = null;
function getClient(): Anthropic {
  if (!client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error(
        "ANTHROPIC_API_KEY is not set. Copy server/.env.example to server/.env and add your key."
      );
    }
    // Identity-linked keys (personal / service-account) are not bound to a
    // workspace, so every request must say which workspace it acts in. Legacy
    // workspace keys carry that implicitly - omit the header for them.
    const workspaceId = process.env.ANTHROPIC_WORKSPACE_ID?.trim();
    client = new Anthropic({
      apiKey,
      ...(workspaceId
        ? { defaultHeaders: { "anthropic-workspace-id": workspaceId } }
        : {}),
    });
  }
  return client;
}

const TOOL_NAME = "emit_diagram_spec";

const DIAGRAM_SPEC_JSON_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "Short title for the architecture" },
    lanes: {
      type: "array",
      description:
        "Optional ordered left-to-right columns for a swim-lane layout, e.g. Sources / Process / Serve. Omit (empty array) for architectures that don't need columns.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          badge: {
            type: "string",
            description:
              "Optional service name badged into this lane's header, for a capability that governs everything inside it, e.g. 'Unity Catalog' on a lakehouse lane to show the data in it is Unity Catalog onboarded.",
          },
        },
        required: ["id", "name"],
      },
    },
    groups: {
      type: "array",
      description:
        "Boxed clusters of related nodes, e.g. 'Store' containing Bronze/Silver/Gold. Optionally pinned to a lane via laneId. Groups CANNOT be nested and every group must directly contain at least one node (via that node's groupId) - to show an outer container spanning several inner clusters, use a lane instead.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          laneId: { type: "string" },
          badge: {
            type: "string",
            description:
              "Optional service name badged into this group's header, for a capability that governs everything inside it (same idea as a lane badge).",
          },
        },
        required: ["id", "name"],
      },
    },
    nodes: {
      type: "array",
      description: "Every service/product icon shown in the main diagram body.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          service: {
            type: "string",
            description:
              "Plain-English official product name, e.g. 'Azure Data Lake Storage', 'Snowflake', 'SAP', 'Power BI', 'Unity Catalog'. Used to look up the real icon - do not invent filenames.",
          },
          badge: {
            type: "string",
            description:
              "Optional second product name, drawn as a small badge on the corner of this node's icon. Use it for 'X stored on / running on Y' where both halves matter, e.g. service 'Azure Data Lake Storage Gen2' + badge 'Delta Lake' for Delta tables whose storage is ADLS. Leave empty for ordinary nodes.",
          },
          label: { type: "string", description: "Caption shown under the icon, defaults to service name" },
          groupId: { type: "string" },
          laneId: { type: "string" },
        },
        required: ["id", "service"],
      },
    },
    edges: {
      type: "array",
      description: "Arrows between nodes representing data/control flow.",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          label: { type: "string" },
          order: {
            type: "integer",
            description: "1-based step number to badge this arrow with a numbered circle, for sequential flows.",
          },
        },
        required: ["from", "to"],
      },
    },
    footers: {
      type: "array",
      description:
        "Horizontal capability bands, e.g. 'Discover and govern' (Purview, Unity Catalog) or 'Platform' (Entra ID, Cost Management, Key Vault, Monitor, DevOps). No edges connect to band items - that is the point of a band.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          position: {
            type: "string",
            enum: ["top", "bottom"],
            description:
              "Where the band sits. Use 'top' for cross-cutting concerns that govern the whole flow (security/identity, auditing & control, governance, monitoring); use 'bottom' for legends and supporting reference material. Defaults to 'bottom'.",
          },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                id: { type: "string" },
                service: { type: "string" },
                label: { type: "string" },
              },
              required: ["id", "service"],
            },
          },
        },
        required: ["id", "name", "items"],
      },
    },
  },
  required: ["title", "nodes"],
} as const;

const SYSTEM_PROMPT = `You design cloud data & analytics reference architecture diagrams in the style of Microsoft's official architecture diagrams: grouped swim lanes (e.g. Sources / Process / Serve), boxed clusters within lanes (e.g. a "Store" band with Bronze/Silver/Gold), numbered arrows for sequential data flow, and footer capability bands (e.g. "Discover and govern", "Platform") for cross-cutting concerns like identity, cost management, key vault, monitoring and CI/CD.

Given a user's plain-English description of a system, call the ${TOOL_NAME} tool with a complete diagram spec:
- Use the real, plain-English product name for every "service" field, exactly as the vendor writes it (e.g. "Azure Event Hubs", "Azure Data Lake Storage", "Azure Machine Learning", "Microsoft Purview", "Azure Key Vault"). Never invent filenames - the name is looked up against a real icon library.
- The icon library is Azure-first but not Azure-only: it also holds the official icons for SAP, Snowflake, Power BI, dbt and the whole Databricks product family (Databricks, Unity Catalog, Delta Lake, Lakeflow Connect, Databricks SQL, Genie, MLflow, Apache Spark, Photon, ...). When the user names a non-Azure product, use it as a node under its own name rather than substituting the nearest Azure equivalent - "SAP", "Snowflake" and "Power BI" are the services the user asked for, not "Azure Center for SAP" or "Azure Synapse Analytics".
- A catalog or governance layer that covers a whole container belongs on that container, not in the flow: put it in the lane's or group's "badge" (e.g. a "Lakehouse" lane badged with "Unity Catalog" says everything in the lane is Unity Catalog onboarded). This is the container-level version of the top capability bands - still no arrows.
- When a node is one technology stored on or running on another, show both: put the underlying platform in "service" and the format/engine on top in "badge" (Delta/Iceberg tables in a lake are the classic case - "Azure Data Lake Storage Gen2" badged with "Delta Lake" says the tables are Delta AND the storage is still ADLS, which neither icon says on its own). Do not use a badge as a second unrelated node.
- Arrows only ever move forward. Lanes are read left to right, so every edge must run from a node to a node in the same lane or a later one. Never park a processing step in a lane to the RIGHT of the store it reads from and writes back into - a "Transformation" lane placed after a Bronze/Silver/Gold group makes every write-back arrow point backwards and shuffles the layers out of order. A read-transform-write step belongs in the same lane and the same group as the stores it moves data between, sitting between them in the chain.
- Show what does the work between stages. A medallion or other multi-stage store is a left-to-right chain inside ONE group, in stage order, with the engine for each hop as its own node in that chain: Bronze -> transform -> Silver -> transform -> Gold. A reader must be able to see what turns Bronze into Silver, not just that Silver exists.
- A compute engine and a transformation framework are not alternatives, so never show one on one hop and the other on the next as if a different engine were chosen per layer. dbt does not replace Spark - it compiles SQL that the platform's own engine (Databricks / Photon / Spark) executes. Keep the engine the same across every hop of the same platform, and when the framework matters too, say both on one node: engine in "service", framework in "badge" (e.g. "Azure Databricks" badged with "dbt").
- A node label names a component, not a hop. "Bronze to Silver (Spark)" describes an arrow, not a thing - that node is a "Databricks Job" or "Spark job". The from/to story belongs in the edge label, which is what the numbered legend prints.
- Only use lanes when the architecture naturally has a left-to-right stage flow. Small/simple architectures can skip lanes and groups entirely and just use nodes + edges.
- Give edges an "order" (1, 2, 3...) when the diagram tells a sequential story, matching the arrows a reader should follow in order. Every ordered edge MUST have a short, specific "label" describing what actually happens on that step (e.g. "Publishes transaction event", "Routes authenticated request") - these labels become a numbered legend explaining the data flow, so generic labels like "sends data" are not useful.
- Every node you create MUST be reachable by at least one edge - a node with no edges will render disconnected from the diagram. Cross-cutting concerns with no natural place in the data flow (identity, secrets, observability, cost, CI/CD, governance/cataloging) belong in "footers", never as standalone "nodes".
- Keep footers for genuinely cross-cutting platform/governance concerns, not primary data-flow nodes.
- Security/identity (Key Vault, Entra ID/AAD), auditing & control, data quality/validation, lineage and governance are ALWAYS cross-cutting bands with position:"top" - never lanes, never nodes, and never the target of an edge. Drawing arrows from every component to Key Vault or to an audit store buries the actual data flow in noise; the band communicates "this applies throughout" without a single arrow.
- End the flow with a single consumption lane (name it "Consumption Layer" unless the user asks otherwise) placed after the application/UI stage, holding what people actually consume plus whatever drives it - BI dashboards and reports, downstream apps, and the orchestration that serves them. Do not give BI/reporting a lane of its own.
- Keep the whole diagram readable: prefer 6-20 nodes for typical prompts.`;

export async function generateDiagramSpec(prompt: string): Promise<DiagramSpec> {
  const spec = await callClaude(prompt);
  return spec;
}

async function callClaude(userPrompt: string, retryFeedback?: string): Promise<DiagramSpec> {
  const anthropic = getClient();

  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: retryFeedback
        ? `${userPrompt}\n\nYour previous response had a problem: ${retryFeedback}\nPlease call ${TOOL_NAME} again with a corrected, fully valid spec.`
        : userPrompt,
    },
  ];

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: "Emit a structured Azure architecture diagram specification.",
        input_schema: DIAGRAM_SPEC_JSON_SCHEMA as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: "tool", name: TOOL_NAME },
    messages,
  });

  // Record token usage for every attempt (including retries below) since
  // each one is a separate billed API call.
  if (response.usage) {
    recordUsage(MODEL, response.usage.input_tokens, response.usage.output_tokens);
  }

  const toolUse = response.content.find(
    (block): block is Anthropic.ToolUseBlock => block.type === "tool_use"
  );
  if (!toolUse) {
    throw new Error("Claude did not return a diagram spec tool call.");
  }

  const parsed = DiagramSpecSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    if (retryFeedback) {
      throw new Error(`Claude's diagram spec was invalid after retry: ${parsed.error.message}`);
    }
    return callClaude(userPrompt, parsed.error.issues.map((i) => i.message).join("; "));
  }

  return parsed.data;
}

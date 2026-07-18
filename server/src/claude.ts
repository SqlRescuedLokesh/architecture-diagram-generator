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
    client = new Anthropic({ apiKey });
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
        },
        required: ["id", "name"],
      },
    },
    groups: {
      type: "array",
      description:
        "Boxed clusters of related nodes, e.g. 'Store' containing Bronze/Silver/Gold. Optionally pinned to a lane via laneId.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          laneId: { type: "string" },
        },
        required: ["id", "name"],
      },
    },
    nodes: {
      type: "array",
      description: "Every Azure resource/service icon shown in the main diagram body.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          service: {
            type: "string",
            description:
              "Plain-English official Azure service name, e.g. 'Azure Databricks', 'Azure Data Lake Storage', 'Power BI'. Used to look up the real icon - do not invent filenames.",
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
        "Horizontal capability bands below the main diagram, e.g. 'Discover and govern' (Purview, Unity Catalog) or 'Platform' (Entra ID, Cost Management, Key Vault, Monitor, DevOps). No edges connect to footer items.",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
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

const SYSTEM_PROMPT = `You design Azure cloud reference architecture diagrams in the style of Microsoft's official architecture diagrams: grouped swim lanes (e.g. Sources / Process / Serve), boxed clusters within lanes (e.g. a "Store" band with Bronze/Silver/Gold), numbered arrows for sequential data flow, and footer capability bands (e.g. "Discover and govern", "Platform") for cross-cutting concerns like identity, cost management, key vault, monitoring and CI/CD.

Given a user's plain-English description of a system, call the ${TOOL_NAME} tool with a complete diagram spec:
- Use real, plain-English Azure service names for every "service" field (e.g. "Azure Event Hubs", "Azure Databricks", "Azure Data Lake Storage", "Power BI", "Azure Machine Learning", "Microsoft Purview", "Azure Key Vault"). Non-Azure technologies that are commonly mentioned alongside Azure services (e.g. Apache Spark, Delta Lake, MLflow) are fine to include as nodes too.
- Only use lanes when the architecture naturally has a left-to-right stage flow. Small/simple architectures can skip lanes and groups entirely and just use nodes + edges.
- Give edges an "order" (1, 2, 3...) when the diagram tells a sequential story, matching the arrows a reader should follow in order. Every ordered edge MUST have a short, specific "label" describing what actually happens on that step (e.g. "Publishes transaction event", "Routes authenticated request") - these labels become a numbered legend explaining the data flow, so generic labels like "sends data" are not useful.
- Every node you create MUST be reachable by at least one edge - a node with no edges will render disconnected from the diagram. Cross-cutting concerns with no natural place in the data flow (identity, secrets, observability, cost, CI/CD, governance/cataloging) belong in "footers", never as standalone "nodes".
- Keep footers for genuinely cross-cutting platform/governance concerns, not primary data-flow nodes.
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

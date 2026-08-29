import { z } from "zod";

export const LaneSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Service badged into this container's header - a governance/platform mark that
   * applies to everything inside it, e.g. Unity Catalog over a lakehouse lane. */
  badge: z.string().optional(),
});

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  laneId: z.string().optional(),
  badge: z.string().optional(),
});

export const NodeSchema = z.object({
  id: z.string(),
  service: z.string(),
  /** A second service drawn as a small badge over the node's icon, for "X on Y"
   * relationships where both halves matter - Delta tables whose storage is still
   * ADLS Gen2 is the icon (ADLS) plus the badge (Delta Lake), not one or the other. */
  badge: z.string().optional(),
  label: z.string().optional(),
  groupId: z.string().optional(),
  laneId: z.string().optional(),
});

export const EdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  order: z.number().int().positive().optional(),
});

export const FooterItemSchema = z.object({
  id: z.string(),
  service: z.string(),
  label: z.string().optional(),
});

export const FooterSchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Cross-cutting bands (security, governance, platform) read better above the flow;
   * legends belong underneath it. */
  position: z.enum(["top", "bottom"]).default("bottom"),
  items: z.array(FooterItemSchema).min(1),
});

export const DiagramSpecSchema = z.object({
  title: z.string(),
  lanes: z.array(LaneSchema).default([]),
  groups: z.array(GroupSchema).default([]),
  nodes: z.array(NodeSchema).min(1),
  edges: z.array(EdgeSchema).default([]),
  footers: z.array(FooterSchema).default([]),
});

export type Lane = z.infer<typeof LaneSchema>;
export type Group = z.infer<typeof GroupSchema>;
export type DiagramNode = z.infer<typeof NodeSchema>;
export type Edge = z.infer<typeof EdgeSchema>;
export type Footer = z.infer<typeof FooterSchema>;
export type DiagramSpec = z.infer<typeof DiagramSpecSchema>;

/** Drops dangling references (edges/groupId/laneId pointing at unknown ids) so the
 * diagram always renders even if the model made a small mistake. Returns the list
 * of problems found (used to decide whether to retry the Claude call). */
export function sanitizeSpec(spec: DiagramSpec): { spec: DiagramSpec; issues: string[] } {
  const issues: string[] = [];
  const laneIds = new Set(spec.lanes.map((l) => l.id));
  const groupIds = new Set(spec.groups.map((g) => g.id));
  const nodeIds = new Set(spec.nodes.map((n) => n.id));

  const nodes = spec.nodes.map((n) => {
    const node = { ...n };
    if (node.laneId && !laneIds.has(node.laneId)) {
      issues.push(`node "${node.id}" references unknown laneId "${node.laneId}"`);
      delete node.laneId;
    }
    if (node.groupId && !groupIds.has(node.groupId)) {
      issues.push(`node "${node.id}" references unknown groupId "${node.groupId}"`);
      delete node.groupId;
    }
    return node;
  });

  const groups = spec.groups
    .map((g) => {
      const group = { ...g };
      if (group.laneId && !laneIds.has(group.laneId)) {
        issues.push(`group "${group.id}" references unknown laneId "${group.laneId}"`);
        delete group.laneId;
      }
      return group;
    })
    // Groups cannot nest, so a model asked for an outer container ("Azure Platform"
    // wrapping Ingestion/Snowflake/...) emits a group no node actually belongs to.
    // ELK sizes a childless compound node as 0x0, which renders as a degenerate box
    // whose label has nowhere to go and spills across the diagram - so drop them.
    .filter((g) => {
      const hasMembers = nodes.some((n) => n.groupId === g.id);
      if (!hasMembers) issues.push(`group "${g.id}" ("${g.name}") has no member nodes - dropped`);
      return hasMembers;
    });

  const edges = spec.edges.filter((e) => {
    const ok = nodeIds.has(e.from) && nodeIds.has(e.to);
    if (!ok) issues.push(`edge "${e.from}" -> "${e.to}" references an unknown node`);
    return ok;
  });

  return { spec: { ...spec, nodes, groups, edges }, issues };
}

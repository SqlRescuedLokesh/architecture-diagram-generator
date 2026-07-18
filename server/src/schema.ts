import { z } from "zod";

export const LaneSchema = z.object({
  id: z.string(),
  name: z.string(),
});

export const GroupSchema = z.object({
  id: z.string(),
  name: z.string(),
  laneId: z.string().optional(),
});

export const NodeSchema = z.object({
  id: z.string(),
  service: z.string(),
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

  const groups = spec.groups.map((g) => {
    const group = { ...g };
    if (group.laneId && !laneIds.has(group.laneId)) {
      issues.push(`group "${group.id}" references unknown laneId "${group.laneId}"`);
      delete group.laneId;
    }
    return group;
  });

  const edges = spec.edges.filter((e) => {
    const ok = nodeIds.has(e.from) && nodeIds.has(e.to);
    if (!ok) issues.push(`edge "${e.from}" -> "${e.to}" references an unknown node`);
    return ok;
  });

  return { spec: { ...spec, nodes, groups, edges }, issues };
}

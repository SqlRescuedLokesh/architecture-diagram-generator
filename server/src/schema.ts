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

  const placed = repairFlowDirection(spec.lanes, groups, nodes, edges, issues);

  return { spec: { ...spec, nodes: placed, groups, edges }, issues };
}

/** The lane a node is actually laid out in: its own, or the lane of the group holding it
 * (a node inside a group takes its column from the group, which is what ELK partitions on). */
function effectiveLaneId(node: DiagramNode, groupById: Map<string, Group>): string | undefined {
  if (node.laneId) return node.laneId;
  if (node.groupId) return groupById.get(node.groupId)?.laneId;
  return undefined;
}

/** Edges that run from a later lane back into an earlier one. Lane order is the diagram's
 * left-to-right reading order and ELK partitions nodes by it, so such an edge is drawn as
 * a literally reversed arrow - and the back-edge drags the nodes around it out of order
 * too. Exported so layout can stop partitioning rather than ship a backwards arrow. */
export function flowReversingEdges(spec: DiagramSpec): Edge[] {
  if (spec.lanes.length === 0) return [];
  const laneIndex = new Map(spec.lanes.map((l, i) => [l.id, i]));
  const groupById = new Map(spec.groups.map((g) => [g.id, g]));
  const nodeById = new Map(spec.nodes.map((n) => [n.id, n]));
  const rank = (id: string): number | undefined => {
    const node = nodeById.get(id);
    if (!node) return undefined;
    const lane = effectiveLaneId(node, groupById);
    return lane === undefined ? undefined : laneIndex.get(lane);
  };
  return spec.edges.filter((e) => {
    const from = rank(e.from);
    const to = rank(e.to);
    return from !== undefined && to !== undefined && to < from;
  });
}

/** Straightens a flow that doubles back on itself. The recurring cause is a processing
 * step parked in its own lane to the RIGHT of the store it both reads from and writes
 * back to - a "Transformation" lane placed after a Bronze/Silver/Gold group makes every
 * write-back arrow point backwards, and ELK's crossing minimisation then shuffles the
 * medallion layers out of order (Gold above Bronze above Silver). A node whose upstream
 * and downstream neighbours all sit in one lane belongs in that lane, so move it there -
 * and into their group when they all share one - which turns the ping-pong into a
 * straight left-to-right chain (bronze -> spark -> silver -> dbt -> gold). Repeats to a
 * fixpoint because moving one node can free up the next. */
function repairFlowDirection(
  lanes: Lane[],
  groups: Group[],
  nodes: DiagramNode[],
  edges: Edge[],
  issues: string[]
): DiagramNode[] {
  if (lanes.length === 0) return nodes;
  const laneIndex = new Map(lanes.map((l, i) => [l.id, i]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  let current = nodes;

  for (let pass = 0; pass < nodes.length; pass++) {
    const byId = new Map(current.map((n) => [n.id, n]));
    const rank = (id: string): number | undefined => {
      const node = byId.get(id);
      if (!node) return undefined;
      const lane = effectiveLaneId(node, groupById);
      return lane === undefined ? undefined : laneIndex.get(lane);
    };

    const stranded = new Set<string>();
    for (const e of edges) {
      const from = rank(e.from);
      const to = rank(e.to);
      if (from !== undefined && to !== undefined && to < from) {
        stranded.add(e.from);
        stranded.add(e.to);
      }
    }
    if (stranded.size === 0) break;

    const moves = new Map<string, DiagramNode>();
    for (const id of stranded) {
      const node = byId.get(id);
      if (!node) continue;
      // A group is a clustering the model chose deliberately (Bronze/Silver/Gold belong
      // together), so never tear a member out of one - the loose node parked in the wrong
      // lane is the thing to move.
      if (node.groupId) continue;
      const preds = edges.filter((e) => e.to === id).map((e) => e.from);
      const succs = edges.filter((e) => e.from === id).map((e) => e.to);
      // Only a node sandwiched in someone else's flow can be confidently relocated;
      // a source or a sink has no second side vouching for where it belongs.
      if (preds.length === 0 || succs.length === 0) continue;
      const neighbours = [...preds, ...succs].map((n) => byId.get(n)).filter((n): n is DiagramNode => !!n);
      const neighbourLanes = new Set(neighbours.map((n) => effectiveLaneId(n, groupById)));
      if (neighbourLanes.size !== 1) continue;
      const [targetLane] = [...neighbourLanes];
      if (targetLane === undefined || targetLane === effectiveLaneId(node, groupById)) continue;

      const neighbourGroups = new Set(neighbours.map((n) => n.groupId));
      const [sharedGroup] = neighbourGroups.size === 1 ? [...neighbourGroups] : [undefined];
      const moved: DiagramNode = { ...node };
      if (sharedGroup && groupById.get(sharedGroup)?.laneId === targetLane) {
        moved.groupId = sharedGroup;
        delete moved.laneId;
      } else {
        moved.laneId = targetLane;
        delete moved.groupId;
      }
      moves.set(id, moved);
      issues.push(
        `node "${id}" sat in a lane after nodes it feeds - moved into "${targetLane}" so the flow reads left to right`
      );
    }

    if (moves.size === 0) break;
    current = current.map((n) => moves.get(n.id) ?? n);
  }

  return current;
}

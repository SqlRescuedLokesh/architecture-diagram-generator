import ELK, { type ElkNode, type ElkExtendedEdge } from "elkjs";
import type { DiagramSpec, DiagramNode, Group } from "./schema.js";
import { resolveIcon } from "./iconManifest.js";

const elk = new ELK();

// --- Layout constants (all rendering is driven by absolute px the client just draws) ---
const NODE_WIDTH = 120;
const NODE_HEIGHT = 82;

const NODE_SPACING = 50;
const LAYER_SPACING = 100;
const COMPONENT_SPACING = 80;

const GROUP_PADDING = 24;
const GROUP_HEADER_H = 28;
const LANE_PADDING = 20;
const LANE_HEADER_H = 34;

const CANVAS_PADDING = 40;
const SECTION_GAP = 28;

const FOOTER_ITEM_W = 96;
const FOOTER_ITEM_H = 64;
const FOOTER_ITEM_GAP = 24;
const FOOTER_HEADER_W = 170;
const FOOTER_BAND_PADDING = 16;
const FOOTER_BAND_GAP = 14;

export interface RenderRect {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderNode {
  id: string;
  label: string;
  iconPath: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RenderEdge {
  id: string;
  label?: string;
  order?: number;
  points: { x: number; y: number }[];
}

export interface RenderFooterItem {
  id: string;
  label: string;
  iconPath: string;
  x: number;
  y: number;
}

export interface RenderFooter {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  items: RenderFooterItem[];
}

export interface RenderFlowStep {
  order: number;
  text: string;
}

export interface RenderDiagram {
  title: string;
  width: number;
  height: number;
  lanes: RenderRect[];
  groups: RenderRect[];
  nodes: RenderNode[];
  edges: RenderEdge[];
  footers: RenderFooter[];
  flowSteps: RenderFlowStep[];
}

function padding(top: number, side: number, bottom: number): string {
  return `[top=${top},left=${side},right=${side},bottom=${bottom}]`;
}

function leafElkNode(n: DiagramNode): ElkNode {
  return { id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT };
}

/** A group is a true ELK compound node (nested container), so ELK's own algorithm
 * guarantees it never overlaps sibling groups/nodes placed in the same lane. */
function groupElkNode(
  g: Group,
  members: DiagramNode[],
  partition: number | undefined,
  ownEdges: ElkExtendedEdge[]
): ElkNode {
  const layoutOptions: Record<string, string> = {
    "elk.padding": padding(GROUP_HEADER_H + GROUP_PADDING, GROUP_PADDING, GROUP_PADDING),
    // Compound nodes don't inherit root's spacing in elkjs - without this, siblings
    // inside a group fall back to ELK's small built-in default and end up crammed together.
    "elk.spacing.nodeNode": String(NODE_SPACING),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_SPACING),
  };
  if (partition !== undefined) layoutOptions["elk.partitioning.partition"] = String(partition);
  return {
    id: g.id,
    layoutOptions,
    children: members.map(leafElkNode),
    edges: ownEdges,
  };
}

/** Builds a flat ELK graph: every group and every "loose" (ungrouped) node sits directly
 * under root, each pinned to its lane's column via ELK partitioning. This keeps entities
 * from different lanes as peers within the same layered pass, which is what makes ELK's
 * node placement land them on a shared top baseline (lanes are computed as bounding boxes
 * around these peers afterward, not as ELK containers themselves - an ELK container per
 * lane would let each lane float to its own independent vertical offset). Groups remain
 * true nested containers so members never overlap a sibling group/node.
 *
 * Each edge is declared inside its lowest common ancestor container (the group both its
 * endpoints share, or root otherwise) rather than always at root - an edge between two
 * siblings inside the same group, if left at root, does not reliably get routed by ELK's
 * hierarchical layout and can collapse into a degenerate near-zero-length segment. */
function buildElkGraph(spec: DiagramSpec): ElkNode {
  const laneIndex = new Map(spec.lanes.map((l, i) => [l.id, i]));
  const groupById = new Map(spec.groups.map((g) => [g.id, g]));

  const nodesByGroup = new Map<string, DiagramNode[]>();
  const looseNodes: DiagramNode[] = [];
  const groupOfNode = new Map<string, string>();

  for (const n of spec.nodes) {
    if (n.groupId && groupById.has(n.groupId)) {
      const arr = nodesByGroup.get(n.groupId) ?? [];
      arr.push(n);
      nodesByGroup.set(n.groupId, arr);
      groupOfNode.set(n.id, n.groupId);
    } else {
      looseNodes.push(n);
    }
  }

  const edgesByContainer = new Map<string, ElkExtendedEdge[]>();
  spec.edges.forEach((e, i) => {
    const fromGroup = groupOfNode.get(e.from);
    const toGroup = groupOfNode.get(e.to);
    const containerId = fromGroup && fromGroup === toGroup ? fromGroup : "root";
    const arr = edgesByContainer.get(containerId) ?? [];
    arr.push({ id: `e${i}`, sources: [e.from], targets: [e.to] } as ElkExtendedEdge);
    edgesByContainer.set(containerId, arr);
  });

  const partitionOf = (laneId?: string): number | undefined =>
    laneId !== undefined ? laneIndex.get(laneId) : undefined;

  const groupChildren = spec.groups.map((g) =>
    groupElkNode(g, nodesByGroup.get(g.id) ?? [], partitionOf(g.laneId), edgesByContainer.get(g.id) ?? [])
  );
  const looseChildren: ElkNode[] = looseNodes.map((n) => {
    const partition = partitionOf(n.laneId);
    const layoutOptions: Record<string, string> = {};
    if (partition !== undefined) layoutOptions["elk.partitioning.partition"] = String(partition);
    return { ...leafElkNode(n), layoutOptions };
  });

  return {
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.layered.spacing.nodeNodeBetweenLayers": String(LAYER_SPACING),
      "elk.spacing.nodeNode": String(NODE_SPACING),
      "elk.spacing.componentComponent": String(COMPONENT_SPACING),
      "elk.layered.considerModelOrder.strategy": "NODES_AND_EDGES",
      ...(spec.lanes.length > 0 ? { "elk.partitioning.activate": "true" } : {}),
    },
    children: [...groupChildren, ...looseChildren],
    edges: edgesByContainer.get("root") ?? [],
  };
}

interface AbsRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface AbsPoint {
  x: number;
  y: number;
}

/** Walks the ELK result tree once, resolving both node positions and edge routes to
 * absolute coordinates. Edge section coordinates are relative to whichever container
 * they were declared in (see buildElkGraph), so they must be shifted by that container's
 * own absolute (x, y) - not just root's - to end up correct. */
function collectAll(
  node: ElkNode,
  parentX: number,
  parentY: number,
  positions: Map<string, AbsRect>,
  edgePoints: Map<string, AbsPoint[]>
) {
  const x = parentX + (node.x ?? 0);
  const y = parentY + (node.y ?? 0);
  if (node.id !== "root") {
    positions.set(node.id, { x, y, width: node.width ?? 0, height: node.height ?? 0 });
  }
  for (const e of node.edges ?? []) {
    const section = e.sections?.[0];
    if (!section) continue;
    const points = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
      x: p.x + x,
      y: p.y + y,
    }));
    edgePoints.set(e.id as string, points);
  }
  for (const child of node.children ?? []) {
    collectAll(child, x, y, positions, edgePoints);
  }
}

function boundingBox(rects: AbsRect[]) {
  return {
    minX: Math.min(...rects.map((r) => r.x)),
    minY: Math.min(...rects.map((r) => r.y)),
    maxX: Math.max(...rects.map((r) => r.x + r.width)),
    maxY: Math.max(...rects.map((r) => r.y + r.height)),
  };
}

export async function layoutDiagram(spec: DiagramSpec): Promise<RenderDiagram> {
  const elkGraph = buildElkGraph(spec);
  const result = await elk.layout(elkGraph);

  const positions = new Map<string, AbsRect>();
  const edgePoints = new Map<string, AbsPoint[]>();
  collectAll(result, 0, 0, positions, edgePoints);

  const rawNodes: RenderNode[] = spec.nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0, width: NODE_WIDTH, height: NODE_HEIGHT };
    const icon = resolveIcon(n.service);
    return {
      id: n.id,
      label: n.label ?? n.service,
      iconPath: icon.path,
      x: pos.x,
      y: pos.y,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
    };
  });

  // Groups come straight from ELK's own compound-node placement (guaranteed non-overlapping).
  const rawGroups: RenderRect[] = spec.groups.flatMap((g) => {
    const pos = positions.get(g.id);
    return pos ? [{ id: g.id, name: g.name, x: pos.x, y: pos.y, width: pos.width, height: pos.height }] : [];
  });

  // Lanes are bounding boxes around their member nodes/groups, computed after layout.
  const rawLanes: RenderRect[] = spec.lanes.flatMap((l) => {
    const memberNodeRects = spec.nodes
      .filter((n) => !n.groupId && n.laneId === l.id)
      .map((n) => positions.get(n.id))
      .filter((r): r is AbsRect => !!r);
    const memberGroupRects = spec.groups
      .filter((g) => g.laneId === l.id)
      .map((g) => positions.get(g.id))
      .filter((r): r is AbsRect => !!r);
    const all = [...memberNodeRects, ...memberGroupRects];
    if (all.length === 0) return [];
    const bbox = boundingBox(all);
    return [
      {
        id: l.id,
        name: l.name,
        x: bbox.minX - LANE_PADDING,
        y: bbox.minY - LANE_PADDING - LANE_HEADER_H,
        width: bbox.maxX - bbox.minX + LANE_PADDING * 2,
        height: bbox.maxY - bbox.minY + LANE_PADDING * 2 + LANE_HEADER_H,
      },
    ];
  });

  // Shift everything so the whole diagram starts at (CANVAS_PADDING, CANVAS_PADDING).
  const mainBBox = boundingBox([...rawNodes, ...rawGroups, ...rawLanes]);
  const offsetX = CANVAS_PADDING - mainBBox.minX;
  const offsetY = CANVAS_PADDING - mainBBox.minY;

  const nodes = rawNodes.map((n) => ({ ...n, x: n.x + offsetX, y: n.y + offsetY }));
  const groups = rawGroups.map((g) => ({ ...g, x: g.x + offsetX, y: g.y + offsetY }));
  const lanes = rawLanes.map((l) => ({ ...l, x: l.x + offsetX, y: l.y + offsetY }));

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const edges: RenderEdge[] = spec.edges.map((specEdge, i) => {
    const id = `e${i}`;
    const collected = edgePoints.get(id);
    let points: { x: number; y: number }[];
    if (collected) {
      points = collected.map((p) => ({ x: p.x + offsetX, y: p.y + offsetY }));
    } else {
      const from = nodeById.get(specEdge.from);
      const to = nodeById.get(specEdge.to);
      points = from && to
        ? [
            { x: from.x + from.width, y: from.y + from.height / 2 },
            { x: to.x, y: to.y + to.height / 2 },
          ]
        : [];
    }
    return {
      id,
      label: specEdge.label,
      order: specEdge.order,
      points,
    };
  });

  const flowSteps: RenderFlowStep[] = spec.edges
    .filter((e): e is typeof e & { order: number } => e.order !== undefined)
    .sort((a, b) => a.order - b.order)
    .map((e) => ({
      order: e.order,
      text: e.label ?? `${nodeById.get(e.from)?.label ?? e.from} to ${nodeById.get(e.to)?.label ?? e.to}`,
    }));

  const mainWidth = Math.max(
    CANVAS_PADDING,
    ...nodes.map((n) => n.x + n.width),
    ...groups.map((g) => g.x + g.width),
    ...lanes.map((l) => l.x + l.width)
  ) + CANVAS_PADDING;
  const mainHeight = Math.max(
    0,
    ...nodes.map((n) => n.y + n.height),
    ...groups.map((g) => g.y + g.height),
    ...lanes.map((l) => l.y + l.height)
  );

  // --- footers: simple horizontal bands stacked below the main diagram ---
  let footerY = mainHeight + SECTION_GAP;
  const footers: RenderFooter[] = spec.footers.map((f) => {
    const items: RenderFooterItem[] = f.items.map((item, idx) => {
      const icon = resolveIcon(item.service);
      return {
        id: item.id,
        label: item.label ?? item.service,
        iconPath: icon.path,
        x: FOOTER_HEADER_W + FOOTER_BAND_PADDING + idx * (FOOTER_ITEM_W + FOOTER_ITEM_GAP),
        y: FOOTER_BAND_PADDING,
      };
    });
    const bandWidth = Math.max(
      mainWidth - CANVAS_PADDING * 2,
      FOOTER_HEADER_W + FOOTER_BAND_PADDING + items.length * (FOOTER_ITEM_W + FOOTER_ITEM_GAP)
    );
    const band: RenderFooter = {
      id: f.id,
      name: f.name,
      x: CANVAS_PADDING,
      y: footerY,
      width: bandWidth,
      height: FOOTER_ITEM_H + FOOTER_BAND_PADDING * 2,
      items: items.map((it) => ({ ...it, x: it.x + CANVAS_PADDING, y: it.y + footerY })),
    };
    footerY += band.height + FOOTER_BAND_GAP;
    return band;
  });

  const totalWidth = Math.max(mainWidth, ...footers.map((f) => f.x + f.width + CANVAS_PADDING));
  const totalHeight = (footers.length > 0 ? footerY - FOOTER_BAND_GAP : mainHeight) + CANVAS_PADDING;

  return {
    title: spec.title,
    width: totalWidth,
    height: totalHeight,
    lanes,
    groups,
    nodes,
    edges,
    footers,
    flowSteps,
  };
}

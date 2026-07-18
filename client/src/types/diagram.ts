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

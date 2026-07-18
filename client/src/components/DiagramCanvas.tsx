import type { RenderDiagram, RenderEdge } from "../types/diagram";

const ICON_SIZE = 48;
const LANE_HEADER_H = 32;
const GROUP_HEADER_H = 26;

function wrapLabel(label: string, maxCharsPerLine = 16): string[] {
  const words = label.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxCharsPerLine && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function edgePath(edge: RenderEdge): string {
  if (edge.points.length === 0) return "";
  const [first, ...rest] = edge.points;
  return (
    `M ${first.x} ${first.y} ` + rest.map((p) => `L ${p.x} ${p.y}`).join(" ")
  );
}

function edgeMidpoint(edge: RenderEdge): { x: number; y: number } {
  const pts = edge.points;
  if (pts.length === 0) return { x: 0, y: 0 };
  const mid = pts[Math.floor((pts.length - 1) / 2)];
  const next = pts[Math.ceil((pts.length - 1) / 2)];
  return { x: (mid.x + next.x) / 2, y: (mid.y + next.y) / 2 };
}

export function DiagramCanvas({ diagram }: { diagram: RenderDiagram }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${diagram.width} ${diagram.height}`}
      width={diagram.width}
      height={diagram.height}
      style={{
        background: "#ffffff",
        fontFamily: "'Segoe UI', Arial, sans-serif",
      }}
    >
      <defs>
        <marker
          id="arrowhead"
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M 0 0 L 10 5 L 0 10 z" fill="#323130" />
        </marker>
      </defs>

      <text x={20} y={26} fontSize={18} fontWeight={700} fill="#201f1e">
        {diagram.title}
      </text>

      {/* Lanes */}
      {diagram.lanes.map((lane) => (
        <g key={lane.id}>
          <rect
            x={lane.x}
            y={lane.y}
            width={lane.width}
            height={lane.height}
            fill="#f7f7f7"
            stroke="#d6d6d6"
            strokeWidth={1}
            rx={4}
          />
          <rect
            x={lane.x}
            y={lane.y}
            width={lane.width}
            height={LANE_HEADER_H}
            fill="#e8e8e8"
            rx={4}
          />
          <text
            x={lane.x + 12}
            y={lane.y + LANE_HEADER_H / 2 + 5}
            fontSize={13}
            fontWeight={700}
            fill="#323130"
          >
            {lane.name}
          </text>
        </g>
      ))}

      {/* Groups */}
      {diagram.groups.map((group) => (
        <g key={group.id}>
          <rect
            x={group.x}
            y={group.y}
            width={group.width}
            height={group.height}
            fill="#ffffff"
            stroke="#c8c8c8"
            strokeDasharray="4 3"
            strokeWidth={1}
            rx={4}
          />
          <text
            x={group.x + 10}
            y={group.y + GROUP_HEADER_H / 2 + 5}
            fontSize={12}
            fontWeight={600}
            fill="#605e5c"
          >
            {group.name}
          </text>
        </g>
      ))}

      {/* Edges (drawn under nodes' labels but arrows should sit above lane fills) */}
      {diagram.edges.map((edge) => (
        <g key={edge.id}>
          <path
            d={edgePath(edge)}
            fill="none"
            stroke="#323130"
            strokeWidth={1.5}
            markerEnd="url(#arrowhead)"
          />
          {edge.order !== undefined && (
            <g
              transform={`translate(${edgeMidpoint(edge).x}, ${edgeMidpoint(edge).y})`}
            >
              <circle r={10} fill="#107c10" />
              <text
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={11}
                fontWeight={700}
                fill="#ffffff"
              >
                {edge.order}
              </text>
            </g>
          )}
        </g>
      ))}

      {/* Nodes */}
      {diagram.nodes.map((node) => {
        const iconX = node.x + (node.width - ICON_SIZE) / 2;
        const lines = wrapLabel(node.label);
        return (
          <g key={node.id}>
            <image
              href={node.iconPath}
              x={iconX}
              y={node.y}
              width={ICON_SIZE}
              height={ICON_SIZE}
            />
            {lines.map((line, i) => (
              <text
                key={i}
                x={node.x + node.width / 2}
                y={node.y + ICON_SIZE + 16 + i * 14}
                textAnchor="middle"
                fontSize={11.5}
                fill="#201f1e"
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}

      {/* Footer bands */}
      {diagram.footers.map((footer) => (
        <g key={footer.id}>
          <rect
            x={footer.x}
            y={footer.y}
            width={footer.width}
            height={footer.height}
            fill="#f7f7f7"
            stroke="#d6d6d6"
            rx={4}
          />
          <circle
            cx={footer.x + 24}
            cy={footer.y + footer.height / 2}
            r={11}
            fill="#0078d4"
          />
          <text
            x={footer.x + 24}
            y={footer.y + footer.height / 2 + 4}
            textAnchor="middle"
            fontSize={12}
            fontWeight={700}
            fill="#ffffff"
          >
            {String(diagram.footers.indexOf(footer) + 1)}
          </text>
          <text
            x={footer.x + 44}
            y={footer.y + footer.height / 2 + 5}
            fontSize={13}
            fontWeight={700}
            fill="#323130"
          >
            {footer.name}
          </text>
          {footer.items.map((item) => (
            <g key={item.id}>
              <image
                href={item.iconPath}
                x={item.x}
                y={item.y}
                width={36}
                height={36}
              />
              <text
                x={item.x + 18}
                y={item.y + 50}
                textAnchor="middle"
                fontSize={10.5}
                fill="#201f1e"
              >
                {item.label.length > 18
                  ? `${item.label.slice(0, 17)}…`
                  : item.label}
              </text>
            </g>
          ))}
        </g>
      ))}

      <g transform={`translate(${diagram.width - 90}, ${diagram.height - 26})`}>
        <text fontSize={10} fill="#8a8886">
          Generated with Azure Diagram Generator
        </text>
      </g>
    </svg>
  );
}

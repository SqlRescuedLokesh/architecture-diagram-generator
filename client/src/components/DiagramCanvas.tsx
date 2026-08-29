import type { RenderDiagram, RenderEdge } from "../types/diagram";

const ICON_SIZE = 48;
// A badge reads as "this thing, on that thing" only if the base icon stays recognisable,
// so it sits in the top-right corner at just under half size, on a white disc that keeps
// it legible over whatever the base icon's artwork happens to be there.
const BADGE_SCALE = 0.46;
const BADGE_HALO = 1.25;
// A container badge sits in the header bar opposite the name, sized to the bar so it
// never bleeds into the box's contents. Right-aligned because names read left-to-right.
const HEADER_BADGE_SCALE = 0.72;
const HEADER_BADGE_PAD = 8;
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

/** Draws the same elbow the .pptx export emits (a single "bentConnector3" bending at the
 * halfway point) rather than ELK's full routed polyline, so the preview matches the deck
 * the user actually downloads. */
function edgePath(edge: RenderEdge): string {
  const pts = edge.points;
  if (pts.length === 0) return "";
  const a = pts[0];
  const b = pts[pts.length - 1];
  const midX = (a.x + b.x) / 2;
  return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`;
}

function edgeMidpoint(edge: RenderEdge): { x: number; y: number } {
  const pts = edge.points;
  if (pts.length === 0) return { x: 0, y: 0 };
  const a = pts[0];
  const b = pts[pts.length - 1];
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
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
          {lane.badgeIconPath && (
            <image
              href={lane.badgeIconPath}
              x={lane.x + lane.width - LANE_HEADER_H * HEADER_BADGE_SCALE - HEADER_BADGE_PAD}
              y={lane.y + (LANE_HEADER_H - LANE_HEADER_H * HEADER_BADGE_SCALE) / 2}
              width={LANE_HEADER_H * HEADER_BADGE_SCALE}
              height={LANE_HEADER_H * HEADER_BADGE_SCALE}
            />
          )}
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
          {group.badgeIconPath && (
            <image
              href={group.badgeIconPath}
              x={group.x + group.width - GROUP_HEADER_H * HEADER_BADGE_SCALE - HEADER_BADGE_PAD}
              y={group.y + (GROUP_HEADER_H - GROUP_HEADER_H * HEADER_BADGE_SCALE) / 2}
              width={GROUP_HEADER_H * HEADER_BADGE_SCALE}
              height={GROUP_HEADER_H * HEADER_BADGE_SCALE}
            />
          )}
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
            {node.badgeIconPath && (() => {
              const size = ICON_SIZE * BADGE_SCALE;
              const bx = iconX + ICON_SIZE - size;
              return (
                <g>
                  <circle
                    cx={bx + size / 2}
                    cy={node.y + size / 2}
                    r={(size / 2) * BADGE_HALO}
                    fill="#ffffff"
                    stroke="#d2d0ce"
                    strokeWidth={0.75}
                  />
                  <image href={node.badgeIconPath} x={bx} y={node.y} width={size} height={size} />
                </g>
              );
            })()}
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

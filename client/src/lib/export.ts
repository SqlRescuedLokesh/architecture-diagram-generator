import pptxgen from "pptxgenjs";
import type { RenderDiagram, RenderEdge } from "../types/diagram";

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "azure-diagram"
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

const ICON_RASTER_SIZE = 128;
const iconPngCache = new Map<string, Promise<string>>();

/** PowerPoint images must be raster data, so each icon is rasterized once (and cached) -
 * loaded as its own top-level <img>, which browsers render fine (unlike an SVG nested
 * inside another SVG that is itself being rasterized). */
function iconToPngDataUrl(href: string): Promise<string> {
  let cached = iconPngCache.get(href);
  if (!cached) {
    cached = loadImage(href).then((img) => {
      const canvas = document.createElement("canvas");
      canvas.width = ICON_RASTER_SIZE;
      canvas.height = ICON_RASTER_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported.");
      ctx.drawImage(img, 0, 0, ICON_RASTER_SIZE, ICON_RASTER_SIZE);
      return canvas.toDataURL("image/png");
    });
    iconPngCache.set(href, cached);
  }
  return cached;
}

const SLIDE_W = 13.33;
const SLIDE_H = 7.5;
const CONTENT_X = 0.4;
const CONTENT_Y = 0.9;
const CONTENT_W = SLIDE_W - CONTENT_X * 2;
const CONTENT_H = SLIDE_H - CONTENT_Y - 0.3;

const COLOR = {
  text: "201F1E",
  laneFill: "F7F7F7",
  laneHeaderFill: "E8E8E8",
  laneStroke: "D6D6D6",
  groupStroke: "C8C8C8",
  groupText: "605E5C",
  edge: "323130",
  badge: "107C10",
  footerCircle: "0078D4",
};

/** Builds a fully editable PowerPoint (every box, line, text and icon is its own
 * shape/picture) from the diagram's render-ready layout, rather than a flattened image. */
export async function downloadPptx(diagram: RenderDiagram) {
  const scale = Math.min(CONTENT_W / diagram.width, CONTENT_H / diagram.height);
  const offsetX = CONTENT_X + (CONTENT_W - diagram.width * scale) / 2;
  const offsetY = CONTENT_Y + (CONTENT_H - diagram.height * scale) / 2;
  const px = (v: number) => v * scale;
  const toX = (v: number) => offsetX + px(v);
  const toY = (v: number) => offsetY + px(v);

  const pptx = new pptxgen();
  pptx.defineLayout({ name: "WIDE", width: SLIDE_W, height: SLIDE_H });
  pptx.layout = "WIDE";
  const slide = pptx.addSlide();

  slide.addText(diagram.title, {
    x: CONTENT_X,
    y: 0.25,
    w: CONTENT_W,
    h: 0.5,
    fontSize: 20,
    bold: true,
    color: COLOR.text,
    fontFace: "Segoe UI",
  });

  // Lanes
  for (const lane of diagram.lanes) {
    const headerH = Math.min(px(32), px(lane.height));
    slide.addShape(pptx.ShapeType.rect, {
      x: toX(lane.x),
      y: toY(lane.y),
      w: px(lane.width),
      h: px(lane.height),
      fill: { color: COLOR.laneFill },
      line: { color: COLOR.laneStroke, width: 0.75 },
    });
    slide.addShape(pptx.ShapeType.rect, {
      x: toX(lane.x),
      y: toY(lane.y),
      w: px(lane.width),
      h: headerH,
      fill: { color: COLOR.laneHeaderFill },
      line: { type: "none" },
    });
    slide.addText(lane.name, {
      x: toX(lane.x) + 0.05,
      y: toY(lane.y),
      w: px(lane.width) - 0.1,
      h: headerH,
      fontSize: 11,
      bold: true,
      color: COLOR.text,
      fontFace: "Segoe UI",
      valign: "middle",
      margin: 0,
    });
  }

  // Groups
  for (const group of diagram.groups) {
    slide.addShape(pptx.ShapeType.rect, {
      x: toX(group.x),
      y: toY(group.y),
      w: px(group.width),
      h: px(group.height),
      fill: { color: "FFFFFF", transparency: 100 },
      line: { color: COLOR.groupStroke, width: 0.75, dashType: "dash" },
    });
    slide.addText(group.name, {
      x: toX(group.x) + 0.05,
      y: toY(group.y),
      w: px(group.width) - 0.1,
      h: 0.22,
      fontSize: 9,
      bold: true,
      color: COLOR.groupText,
      fontFace: "Segoe UI",
      margin: 0,
    });
  }

  // Edges (drawn as straight segments between consecutive routed points)
  for (const edge of diagram.edges) {
    addEdgeShapes(pptx, slide, edge, toX, toY);
  }

  // Nodes: icon picture + caption text
  for (const node of diagram.nodes) {
    const png = await iconToPngDataUrl(node.iconPath);
    const iconSize = 0.5;
    const iconX = toX(node.x) + px(node.width) / 2 - iconSize / 2;
    slide.addImage({
      data: png,
      x: iconX,
      y: toY(node.y),
      w: iconSize,
      h: iconSize,
    });
    slide.addText(node.label, {
      x: toX(node.x),
      y: toY(node.y) + iconSize + 0.03,
      w: px(node.width),
      h: 0.35,
      fontSize: 8,
      color: COLOR.text,
      fontFace: "Segoe UI",
      align: "center",
      valign: "top",
      margin: 0,
    });
  }

  // Footer bands
  for (const [i, footer] of diagram.footers.entries()) {
    slide.addShape(pptx.ShapeType.rect, {
      x: toX(footer.x),
      y: toY(footer.y),
      w: px(footer.width),
      h: px(footer.height),
      fill: { color: COLOR.laneFill },
      line: { color: COLOR.laneStroke, width: 0.75 },
    });
    slide.addText(String(i + 1), {
      shape: pptx.ShapeType.ellipse,
      x: toX(footer.x) + 0.08,
      y: toY(footer.y) + px(footer.height) / 2 - 0.11,
      w: 0.22,
      h: 0.22,
      fontSize: 9,
      bold: true,
      color: "FFFFFF",
      fill: { color: COLOR.footerCircle },
      align: "center",
      valign: "middle",
      margin: 0,
    });
    slide.addText(footer.name, {
      x: toX(footer.x) + 0.38,
      y: toY(footer.y),
      w: 1.6,
      h: px(footer.height),
      fontSize: 10,
      bold: true,
      color: COLOR.text,
      fontFace: "Segoe UI",
      valign: "middle",
      margin: 0,
    });
    for (const item of footer.items) {
      const png = await iconToPngDataUrl(item.iconPath);
      const iconSize = 0.38;
      slide.addImage({
        data: png,
        x: toX(item.x),
        y: toY(item.y),
        w: iconSize,
        h: iconSize,
      });
      slide.addText(item.label, {
        x: toX(item.x) - 0.15,
        y: toY(item.y) + iconSize + 0.02,
        w: iconSize + 0.3,
        h: 0.3,
        fontSize: 7,
        color: COLOR.text,
        fontFace: "Segoe UI",
        align: "center",
        margin: 0,
      });
    }
  }

  if (diagram.flowSteps.length > 0) {
    addFlowLegendSlide(pptx, diagram);
  }

  await pptx.writeFile({ fileName: `${slugify(diagram.title)}.pptx` });
}

function addFlowLegendSlide(pptx: pptxgen, diagram: RenderDiagram) {
  const slide = pptx.addSlide();
  slide.addText("How the data flows", {
    x: CONTENT_X,
    y: 0.4,
    w: CONTENT_W,
    h: 0.5,
    fontSize: 20,
    bold: true,
    color: COLOR.text,
    fontFace: "Segoe UI",
  });

  const rows = diagram.flowSteps.map((step) => [
    {
      text: String(step.order),
      options: {
        fontSize: 11,
        bold: true,
        color: "FFFFFF",
        fill: { color: COLOR.badge },
        align: "center" as const,
        valign: "middle" as const,
      },
    },
    { text: step.text, options: { fontSize: 13, color: COLOR.text, fontFace: "Segoe UI" } },
  ]);

  slide.addTable(rows, {
    x: CONTENT_X,
    y: 1.1,
    w: CONTENT_W,
    colW: [0.5, CONTENT_W - 0.5],
    border: { type: "none" },
    autoPage: true,
    rowH: 0.4,
    valign: "middle",
  });
}

function addEdgeShapes(
  pptx: pptxgen,
  slide: pptxgen.Slide,
  edge: RenderEdge,
  toX: (v: number) => number,
  toY: (v: number) => number,
) {
  const pts = edge.points;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const isLast = i === pts.length - 2;
    const x1 = toX(a.x);
    const y1 = toY(a.y);
    const x2 = toX(b.x);
    const y2 = toY(b.y);
    const flipV = x2 >= x1 !== y2 >= y1;

    slide.addShape(pptx.ShapeType.line, {
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1) || 0.001,
      h: Math.abs(y2 - y1) || 0.001,
      flipV,
      line: {
        color: COLOR.edge,
        width: 1.25,
        endArrowType: isLast ? "triangle" : "none",
      },
    });
  }

  if (edge.order !== undefined && pts.length > 0) {
    const mid = pts[Math.floor((pts.length - 1) / 2)];
    const next = pts[Math.ceil((pts.length - 1) / 2)];
    const cx = toX((mid.x + next.x) / 2);
    const cy = toY((mid.y + next.y) / 2);
    slide.addText(String(edge.order), {
      shape: pptx.ShapeType.ellipse,
      x: cx - 0.11,
      y: cy - 0.11,
      w: 0.22,
      h: 0.22,
      fontSize: 8,
      bold: true,
      color: "FFFFFF",
      fill: { color: COLOR.badge },
      align: "center",
      valign: "middle",
      margin: 0,
    });
  }
}

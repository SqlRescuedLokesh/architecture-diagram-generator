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

// --- Slide sizing ---------------------------------------------------------
//
// The slide is sized to the diagram rather than the diagram being crammed onto a
// fixed 16:9 slide. A big architecture diagram (many lanes/groups) is several
// thousand layout units wide; forcing that into 13.33in gives ~0.5in nodes whose
// labels need several inches, and PowerPoint does not clip overflowing text - it
// spills across neighbouring shapes, which is what made exports look jumbled.
// So: render at a fixed, legible scale and grow the slide instead, falling back to
// shrinking only when the diagram exceeds PowerPoint's 56in limit.

const DEFAULT_SLIDE_W = 13.33;
const DEFAULT_SLIDE_H = 7.5;
/** PowerPoint refuses slide dimensions larger than 56 inches. */
const MAX_SLIDE_IN = 56;
const CONTENT_X = 0.4;
const CONTENT_TOP = 0.9;
const CONTENT_BOTTOM = 0.3;

/** The scale the point sizes below are chosen for: one 120-unit node ≈ 1.15in wide. */
const TARGET_SCALE = 0.0096;
const MIN_FONT_PT = 5;
const LINE_HEIGHT = 1.2;
/** Rough average glyph advance for Segoe UI, as a fraction of the em size. Only used
 * to predict wrapping so text can be shrunk to fit - slightly generous on purpose. */
const AVG_CHAR_W_EM = 0.52;
/** layout.ts leaves a 50-unit gap under each node; a caption may borrow 40 of it,
 * so long labels get room to wrap without ever reaching the node below. */
const CAPTION_OVERFLOW_UNITS = 40;

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

/** Clamps a computed pptxgenjs shape dimension to a small positive floor. Naive
 * `px(x) - padding` math can go zero/negative on a heavily scaled-down diagram, and a
 * negative extent is invalid OOXML - PowerPoint then refuses to open the file outright
 * rather than offering to repair it. */
function clampSize(v: number, min = 0.05): number {
  return Math.max(v, min);
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(Math.max(v, min), max);
}

export interface ExportMetrics {
  slideW: number;
  slideH: number;
  scale: number;
  fontScale: number;
  offsetX: number;
  offsetY: number;
}

export function computeExportMetrics(diagram: RenderDiagram): ExportMetrics {
  const w = Math.max(1, diagram.width);
  const h = Math.max(1, diagram.height);

  const slideW = clamp(CONTENT_X * 2 + w * TARGET_SCALE, DEFAULT_SLIDE_W, MAX_SLIDE_IN);
  const slideH = clamp(CONTENT_TOP + CONTENT_BOTTOM + h * TARGET_SCALE, DEFAULT_SLIDE_H, MAX_SLIDE_IN);

  const contentW = slideW - CONTENT_X * 2;
  const contentH = slideH - CONTENT_TOP - CONTENT_BOTTOM;
  const scale = Math.min(contentW / w, contentH / h);

  // Only ever shrink type: at TARGET_SCALE (or on a small diagram given the minimum
  // slide, where scale is larger) the base point sizes are already right.
  const fontScale = Math.min(1, scale / TARGET_SCALE);

  return {
    slideW,
    slideH,
    scale,
    fontScale,
    offsetX: CONTENT_X + (contentW - w * scale) / 2,
    offsetY: CONTENT_TOP + (contentH - h * scale) / 2,
  };
}

/** Predicts how many lines `text` wraps to in a box `widthIn` wide at `pt`, honouring
 * newlines the model put in the label. */
function wrappedLineCount(text: string, widthIn: number, pt: number): number {
  const charW = (pt / 72) * AVG_CHAR_W_EM;
  const perLine = Math.max(1, Math.floor(widthIn / charW));
  return text
    .split("\n")
    .reduce((acc, line) => acc + Math.max(1, Math.ceil(line.trim().length / perLine)), 0);
}

/** Largest point size (down to MIN_FONT_PT) at which `text` still fits the box.
 * PowerPoint does not clip overflow, so anything that does not fit would be drawn
 * on top of neighbouring shapes. */
function fitFontSize(text: string, widthIn: number, heightIn: number, basePt: number): number {
  for (let pt = basePt; pt > MIN_FONT_PT; pt -= 0.5) {
    if (wrappedLineCount(text, widthIn, pt) * (pt / 72) * LINE_HEIGHT <= heightIn) return pt;
  }
  return MIN_FONT_PT;
}

/** Builds a fully editable PowerPoint (every box, line, text and icon is its own
 * shape/picture) from the diagram's render-ready layout, rather than a flattened image. */
export async function downloadPptx(diagram: RenderDiagram) {
  const m = computeExportMetrics(diagram);
  const px = (v: number) => v * m.scale;
  const toX = (v: number) => m.offsetX + px(v);
  const toY = (v: number) => m.offsetY + px(v);
  /** Base point size adjusted for how far the diagram had to shrink. */
  const pt = (base: number) => Math.max(MIN_FONT_PT, base * m.fontScale);

  const pptx = new pptxgen();
  pptx.defineLayout({ name: "WIDE", width: m.slideW, height: m.slideH });
  pptx.layout = "WIDE";
  const slide = pptx.addSlide();

  const contentW = m.slideW - CONTENT_X * 2;
  const titlePt = clamp(20 * Math.sqrt(m.slideW / DEFAULT_SLIDE_W), 20, 40);
  slide.addText(diagram.title, {
    x: CONTENT_X,
    y: 0.25,
    w: contentW,
    h: 0.5,
    fontSize: titlePt,
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
    const labelW = clampSize(px(lane.width) - 0.1);
    slide.addText(lane.name, {
      x: toX(lane.x) + 0.05,
      y: toY(lane.y),
      w: labelW,
      h: headerH,
      fontSize: fitFontSize(lane.name, labelW, headerH, pt(11)),
      bold: true,
      color: COLOR.text,
      fontFace: "Segoe UI",
      valign: "middle",
      margin: 0,
    });
  }

  // Groups. A zero-sized group carries no meaning and its label would have nowhere to
  // wrap, so skip it rather than emit a degenerate box (see sanitizeSpec, which also
  // drops childless groups upstream).
  for (const group of diagram.groups) {
    if (group.width <= 0 || group.height <= 0) continue;
    slide.addShape(pptx.ShapeType.rect, {
      x: toX(group.x),
      y: toY(group.y),
      w: px(group.width),
      h: px(group.height),
      fill: { color: "FFFFFF", transparency: 100 },
      line: { color: COLOR.groupStroke, width: 0.75, dashType: "dash" },
    });
    const labelW = clampSize(px(group.width) - 0.1);
    const labelH = clampSize(Math.min(px(28), px(group.height)), 0.08);
    slide.addText(group.name, {
      x: toX(group.x) + 0.05,
      y: toY(group.y),
      w: labelW,
      h: labelH,
      fontSize: fitFontSize(group.name, labelW, labelH, pt(9)),
      bold: true,
      color: COLOR.groupText,
      fontFace: "Segoe UI",
      margin: 0,
    });
  }

  // Edges (drawn as straight segments between consecutive routed points)
  for (const edge of diagram.edges) {
    addEdgeShapes(pptx, slide, edge, toX, toY, px, m.fontScale);
  }

  // Nodes: icon picture + caption text. Both are sized from the node's own scaled box
  // (like DiagramCanvas sizes its icon in diagram units) so they shrink in lockstep
  // with node spacing instead of being fixed inches that only suit one diagram size.
  const captionGap = clampSize(px(4), 0.02);
  for (const node of diagram.nodes) {
    const png = await iconToPngDataUrl(node.iconPath);
    const boxW = px(node.width);
    const boxH = px(node.height);
    const iconSize = clampSize(Math.min(boxH * 0.58, boxW * 0.9));
    const captionH = clampSize(boxH - iconSize - captionGap + px(CAPTION_OVERFLOW_UNITS), 0.04);
    slide.addImage({
      data: png,
      x: toX(node.x) + boxW / 2 - iconSize / 2,
      y: toY(node.y),
      w: iconSize,
      h: iconSize,
    });
    slide.addText(node.label, {
      x: toX(node.x),
      y: toY(node.y) + iconSize + captionGap,
      w: boxW,
      h: captionH,
      fontSize: fitFontSize(node.label, boxW, captionH, pt(8)),
      color: COLOR.text,
      fontFace: "Segoe UI",
      align: "center",
      valign: "top",
      margin: 0,
    });
  }

  // Footer bands
  for (const [i, footer] of diagram.footers.entries()) {
    const bandH = px(footer.height);
    slide.addShape(pptx.ShapeType.rect, {
      x: toX(footer.x),
      y: toY(footer.y),
      w: px(footer.width),
      h: bandH,
      fill: { color: COLOR.laneFill },
      line: { color: COLOR.laneStroke, width: 0.75 },
    });

    const badge = clampSize(Math.min(bandH * 0.3, px(26)), 0.1);
    slide.addText(String(i + 1), {
      shape: pptx.ShapeType.ellipse,
      x: toX(footer.x) + badge * 0.35,
      y: toY(footer.y) + bandH / 2 - badge / 2,
      w: badge,
      h: badge,
      fontSize: Math.max(MIN_FONT_PT, badge * 36),
      bold: true,
      color: "FFFFFF",
      fill: { color: COLOR.footerCircle },
      align: "center",
      valign: "middle",
      margin: 0,
    });

    // The band's name column runs up to wherever layout placed the first item.
    const nameX = toX(footer.x) + badge * 1.6;
    const firstItemX = footer.items.length > 0 ? toX(footer.items[0].x) : toX(footer.x + footer.width);
    const nameW = clampSize(firstItemX - nameX - px(8));
    slide.addText(footer.name, {
      x: nameX,
      y: toY(footer.y),
      w: nameW,
      h: bandH,
      fontSize: fitFontSize(footer.name, nameW, bandH, pt(10)),
      bold: true,
      color: COLOR.text,
      fontFace: "Segoe UI",
      valign: "middle",
      margin: 0,
    });

    for (const item of footer.items) {
      const png = await iconToPngDataUrl(item.iconPath);
      const iconSize = clampSize(bandH * 0.45);
      const captionH = clampSize(bandH - iconSize - captionGap, 0.04);
      const captionW = iconSize * 1.8;
      slide.addImage({
        data: png,
        x: toX(item.x),
        y: toY(item.y),
        w: iconSize,
        h: iconSize,
      });
      slide.addText(item.label, {
        x: toX(item.x) - iconSize * 0.4,
        y: toY(item.y) + iconSize + captionGap,
        w: captionW,
        h: captionH,
        fontSize: fitFontSize(item.label, captionW, captionH, pt(7)),
        color: COLOR.text,
        fontFace: "Segoe UI",
        align: "center",
        margin: 0,
      });
    }
  }

  if (diagram.flowSteps.length > 0) {
    addFlowLegendSlide(pptx, diagram, contentW);
  }

  await pptx.writeFile({ fileName: `${slugify(diagram.title)}.pptx` });
}

function addFlowLegendSlide(pptx: pptxgen, diagram: RenderDiagram, contentW: number) {
  const slide = pptx.addSlide();
  slide.addText("How the data flows", {
    x: CONTENT_X,
    y: 0.4,
    w: contentW,
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
    w: contentW,
    colW: [0.5, contentW - 0.5],
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
  px: (v: number) => number,
  fontScale: number,
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
        width: Math.max(0.5, 1.25 * fontScale),
        endArrowType: isLast ? "triangle" : "none",
      },
    });
  }

  if (edge.order !== undefined && pts.length > 0) {
    const mid = pts[Math.floor((pts.length - 1) / 2)];
    const next = pts[Math.ceil((pts.length - 1) / 2)];
    const cx = toX((mid.x + next.x) / 2);
    const cy = toY((mid.y + next.y) / 2);
    // Badges scale with the diagram too - a fixed-inch badge dwarfs the nodes once
    // the diagram is large enough to be scaled down.
    const badge = clampSize(px(26), 0.1);
    slide.addText(String(edge.order), {
      shape: pptx.ShapeType.ellipse,
      x: cx - badge / 2,
      y: cy - badge / 2,
      w: badge,
      h: badge,
      fontSize: Math.max(MIN_FONT_PT, badge * 34),
      bold: true,
      color: "FFFFFF",
      fill: { color: COLOR.badge },
      align: "center",
      valign: "middle",
      margin: 0,
    });
  }
}

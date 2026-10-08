// One list of drawing entities, written twice: as a DXF in inches for AutoCAD, and as an SVG preview.
import { DOOR, type Layout } from "./floorplan";

export type Ent =
  | { t: "line"; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { t: "arc"; layer: string; cx: number; cy: number; r: number; a1: number; a2: number }
  | { t: "text"; layer: string; x: number; y: number; h: number; s: string };

export const LAYERS: Record<string, { color: number; stroke: string; width: number }> = {
  PLOT: { color: 8, stroke: "#9aa3ab", width: 1 },
  WALLS: { color: 7, stroke: "#14213d", width: 3 },
  DOORS: { color: 30, stroke: "#c8553d", width: 1.5 },
  WINDOWS: { color: 5, stroke: "#1d6fe0", width: 4 },
  TEXT: { color: 7, stroke: "#14213d", width: 0 },
  DIMS: { color: 3, stroke: "#2a9d8f", width: 1 },
};

/** 19.083 ft -> 19'-1" */
export function feet(v: number): string {
  let inches = Math.round(v * 12);
  const ft = Math.floor(inches / 12);
  inches -= ft * 12;
  return `${ft}'-${inches}"`;
}

type Span = [number, number];

function union(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const [a, b] of [...spans].sort((p, q) => p[0] - q[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + 1e-6) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function cut(spans: Span[], holes: Span[]): Span[] {
  let out = spans;
  for (const [h1, h2] of holes)
    out = out.flatMap(([a, b]): Span[] => {
      if (h2 <= a || h1 >= b) return [[a, b]];
      const parts: Span[] = [];
      if (h1 - a > 1e-6) parts.push([a, h1]);
      if (b - h2 > 1e-6) parts.push([h2, b]);
      return parts;
    });
  return out;
}

export function entities(lay: Layout, title: string): Ent[] {
  const [W, D] = lay.plot;
  const ents: Ent[] = [];
  const line = (layer: string, x1: number, y1: number, x2: number, y2: number) => ents.push({ t: "line", layer, x1, y1, x2, y2 });
  const key = (o: "h" | "v", at: number) => `${o}:${at.toFixed(3)}`;

  // every room edge is a wall; shared edges merge into one line, then doors and windows cut their openings
  const walls = new Map<string, Span[]>();
  const holes = new Map<string, Span[]>();
  const put = (m: Map<string, Span[]>, k: string, s: Span) => m.set(k, [...(m.get(k) ?? []), s]);
  for (const r of lay.rooms) {
    if (r.kind === "yard") continue;
    if (r.kind !== "porch") put(walls, key("h", r.y), [r.x, r.x + r.w]); // the porch is open to the road
    put(walls, key("h", r.y + r.h), [r.x, r.x + r.w]);
    put(walls, key("v", r.x), [r.y, r.y + r.h]);
    put(walls, key("v", r.x + r.w), [r.y, r.y + r.h]);
  }
  for (const d of lay.doors) put(holes, key(d.wall, d.wall === "h" ? d.y : d.x), d.wall === "h" ? [d.x - DOOR / 2, d.x + DOOR / 2] : [d.y - DOOR / 2, d.y + DOOR / 2]);
  for (const w of lay.windows) {
    const o = w.y1 === w.y2 ? "h" : "v";
    put(holes, key(o, o === "h" ? w.y1 : w.x1), o === "h" ? [w.x1, w.x2] : [w.y1, w.y2]);
  }

  for (const [x1, y1, x2, y2] of [[0, 0, W, 0], [W, 0, W, D], [W, D, 0, D], [0, D, 0, 0]]) line("PLOT", x1, y1, x2, y2);
  for (const [k, spans] of walls) {
    const [o, at] = [k[0], Number(k.slice(2))];
    for (const [a, b] of cut(union(spans), holes.get(k) ?? [])) o === "h" ? line("WALLS", a, at, b, at) : line("WALLS", at, a, at, b);
  }
  for (const d of lay.doors) {
    // the leaf stands open at a right angle to its wall, with the quarter circle it sweeps
    const [hx, hy] = d.wall === "h" ? [d.x - DOOR / 2, d.y] : [d.x, d.y - DOOR / 2];
    d.wall === "h" ? line("DOORS", hx, hy, hx, hy + DOOR) : line("DOORS", hx, hy, hx + DOOR, hy);
    ents.push({ t: "arc", layer: "DOORS", cx: hx, cy: hy, r: DOOR, a1: 0, a2: 90 });
  }
  for (const w of lay.windows) line("WINDOWS", w.x1, w.y1, w.x2, w.y2);

  for (const r of lay.rooms) {
    if (r.kind === "yard") continue;
    const h = Math.min(0.9, (r.w - 0.6) / (r.name.length * 0.62));
    const [cx, cy] = [r.x + r.w / 2, r.y + r.h / 2];
    ents.push({ t: "text", layer: "TEXT", x: cx, y: cy + (r.kind === "passage" ? -0.3 : 0.2), h, s: r.name });
    if (r.kind !== "passage") ents.push({ t: "text", layer: "TEXT", x: cx, y: cy - 1.1, h: Math.min(0.65, h), s: `${feet(r.w)} x ${feet(r.h)}` });
  }

  // overall dimensions, and the title under the sheet
  line("DIMS", 0, -3, W, -3);
  line("DIMS", 0, -3.6, 0, -2.4);
  line("DIMS", W, -3.6, W, -2.4);
  ents.push({ t: "text", layer: "DIMS", x: W / 2, y: -5, h: 0.9, s: feet(W) });
  line("DIMS", -3, 0, -3, D);
  line("DIMS", -3.6, 0, -2.4, 0);
  line("DIMS", -3.6, D, -2.4, D);
  ents.push({ t: "text", layer: "DIMS", x: -5.5, y: D / 2, h: 0.9, s: feet(D) });
  ents.push({ t: "text", layer: "TEXT", x: W / 2, y: -8, h: 1, s: title });
  return ents;
}

/** An ASCII DXF (R12 entities) in inches, which is what AutoCAD expects of an imperial drawing. */
export function toDxf(ents: Ent[], lay: Layout): string {
  const out: Array<string | number> = [];
  const g = (...pairs: Array<string | number>) => out.push(...pairs);
  const n = (v: number) => Number((v * 12).toFixed(4)); // feet -> inches
  const [W, D] = lay.plot;
  g(0, "SECTION", 2, "HEADER", 9, "$ACADVER", 1, "AC1009", 9, "$INSUNITS", 70, 1);
  g(9, "$EXTMIN", 10, n(-7), 20, n(-9), 30, 0, 9, "$EXTMAX", 10, n(W), 20, n(D), 30, 0, 0, "ENDSEC");
  g(0, "SECTION", 2, "TABLES", 0, "TABLE", 2, "LAYER", 70, Object.keys(LAYERS).length);
  for (const [name, l] of Object.entries(LAYERS)) g(0, "LAYER", 2, name, 70, 0, 62, l.color, 6, "CONTINUOUS");
  g(0, "ENDTAB", 0, "ENDSEC", 0, "SECTION", 2, "ENTITIES");
  for (const e of ents) {
    if (e.t === "line") g(0, "LINE", 8, e.layer, 10, n(e.x1), 20, n(e.y1), 30, 0, 11, n(e.x2), 21, n(e.y2), 31, 0);
    else if (e.t === "arc") g(0, "ARC", 8, e.layer, 10, n(e.cx), 20, n(e.cy), 30, 0, 40, n(e.r), 50, e.a1, 51, e.a2);
    else g(0, "TEXT", 8, e.layer, 10, n(e.x), 20, n(e.y), 30, 0, 40, n(e.h), 1, e.s, 72, 1, 11, n(e.x), 21, n(e.y), 31, 0); // centred
  }
  g(0, "ENDSEC", 0, "EOF");
  return out.join("\n") + "\n";
}

export function toSvg(ents: Ent[], lay: Layout): string {
  const [W, D] = lay.plot;
  const k = 12; // pixels per foot
  const [left, bottom, right, top] = [-8, -10, W + 3, D + 3];
  const X = (x: number) => ((x - left) * k).toFixed(1);
  const Y = (y: number) => ((top - y) * k).toFixed(1); // DXF y runs up, SVG y runs down
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
  const parts = ents.map((e) => {
    const l = LAYERS[e.layer];
    if (e.t === "line") return `<line x1="${X(e.x1)}" y1="${Y(e.y1)}" x2="${X(e.x2)}" y2="${Y(e.y2)}" stroke="${l.stroke}" stroke-width="${l.width}" stroke-linecap="square"/>`;
    if (e.t === "arc") {
      const rad = (a: number) => (a * Math.PI) / 180;
      const [sx, sy, ex, ey] = [e.cx + e.r * Math.cos(rad(e.a1)), e.cy + e.r * Math.sin(rad(e.a1)), e.cx + e.r * Math.cos(rad(e.a2)), e.cy + e.r * Math.sin(rad(e.a2))];
      return `<path d="M ${X(sx)} ${Y(sy)} A ${e.r * k} ${e.r * k} 0 0 0 ${X(ex)} ${Y(ey)}" fill="none" stroke="${l.stroke}" stroke-width="${l.width}"/>`;
    }
    return `<text x="${X(e.x)}" y="${Y(e.y)}" font-size="${(e.h * k * 1.25).toFixed(1)}" text-anchor="middle" fill="${l.stroke}">${esc(e.s)}</text>`;
  });
  const [w, h] = [(right - left) * k, (top - bottom) * k];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" font-family="Segoe UI, Arial, sans-serif"><rect width="100%" height="100%" fill="#fdfcf8"/>${parts.join("")}</svg>`;
}

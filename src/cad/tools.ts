// The drafting tool: a brief becomes a DXF for AutoCAD, checked three ways before it is returned.
import DxfParser from "dxf-parser";
import { tool, type Args, type ToolCtx } from "../toolkit/registry";
import { outFile, refuse, result, type ToolResult } from "../toolkit/result";
import { entities, feet, LAYERS, toDxf, toSvg, type Ent } from "./draw";
import { bedroomsAcross, MIN_WIDTH, plan, reachable, SETBACK, type Layout } from "./floorplan";

// marla -> feet wide x deep. A marla is 225 sq ft here.
export const PLOTS: Record<number, [number, number]> = {
  3: [20, 34], 4: [22, 41], 5: [25, 45], 6: [30, 45], 7: [30, 52], 8: [30, 60],
  10: [35, 65], 12: [40, 68], 15: [45, 75], 20: [50, 90], 40: [75, 120],
};

const SCALES = [50, 75, 100, 125, 150, 200];
const SHEET: [number, number] = [390, 231]; // drawing room on a landscape A3, in mm
const MARGIN = 60; // mm kept around the plan for dimensions and the title

/** '10 marla', '1 kanal' or '35 x 65 ft' -> feet wide x deep */
export function plotSize(plot: string): [number, number] | string {
  let m = plot.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/i);
  if (m) return [Number(m[1]), Number(m[2])];
  m = plot.match(/(\d+(?:\.\d+)?)\s*(marla|kanal)/i);
  if (!m) return `I can't read '${plot}' as a plot: say '10 marla', '1 kanal' or '35 x 65 ft'`;
  const marla = Number(m[1]) * (m[2].toLowerCase() === "kanal" ? 20 : 1);
  return PLOTS[marla] ?? `I have no standard plot for ${marla} marla: I know ${Object.keys(PLOTS).join(", ")} marla, or give feet like '35 x 65 ft'`;
}

const needs = (lay: Layout, scale: number): [number, number] =>
  [Math.round((lay.plot[0] * 304.8) / scale + MARGIN), Math.round((lay.plot[1] * 304.8) / scale + MARGIN)];
const fits = (lay: Layout, scale: number) => needs(lay, scale)[0] <= SHEET[0] && needs(lay, scale)[1] <= SHEET[1];

/** Six rules about the plan itself. */
function checkPlan(lay: Layout): Array<[string, boolean]> {
  const [W, D] = lay.plot;
  const real = lay.rooms.filter((r) => r.kind !== "yard");
  const walked = reachable(lay.rooms, lay.doors);
  const overlap = lay.rooms.some((a, i) =>
    lay.rooms.slice(i + 1).some((b) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 1e-6),
  );
  const beds = lay.rooms.filter((r) => r.kind === "bed");
  const withBath = beds.every((b) => lay.doors.some((d) => d.a === b.id && d.b === b.id.replace("bed", "bath")));
  const area = lay.rooms.reduce((s, r) => s + r.w * r.h, 0);
  return [
    ["plan: every room can be walked to from the car porch", real.every((r) => walked.has(r.id))],
    ["plan: no two rooms overlap", !overlap],
    ["plan: every room is on the plot, behind the front setback", lay.rooms.every((r) => r.x >= -1e-6 && r.x + r.w <= W + 1e-6 && r.y >= SETBACK - 1e-6 && r.y + r.h <= D + 1e-6)],
    [`plan: ${lay.bedrooms} bedroom(s), each with a door to its own bath`, beds.length === lay.bedrooms && withBath],
    ["plan: no room is narrower than its minimum", real.every((r) => Math.min(r.w, r.h) >= MIN_WIDTH[r.kind] - 1e-6)],
    ["plan: rooms and yards fill the plot behind the setback with no gaps", Math.abs(area - W * (D - SETBACK)) < 1e-3],
  ];
}

/** Read the saved DXF back with dxf-parser, which knows nothing about our writer. */
function checkDxf(text: string, ents: Ent[], lay: Layout): Array<[string, boolean]> {
  let dxf: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    dxf = new DxfParser().parseSync(text);
  } catch {
    /* reported by the first check */
  }
  if (!dxf) return [["DXF: the file parses", false]];
  const got: any[] = dxf.entities ?? []; // eslint-disable-line @typescript-eslint/no-explicit-any
  const count = (type: string, layer: string) => got.filter((e) => e.type === type && e.layer === layer).length;
  const wrote = (t: Ent["t"], layer: string) => ents.filter((e) => e.t === t && e.layer === layer).length;
  const plotLines = got.filter((e) => e.type === "LINE" && e.layer === "PLOT").flatMap((e) => e.vertices);
  const labels = got.filter((e) => e.type === "TEXT").map((e) => e.text);
  const rooms = lay.rooms.filter((r) => r.kind !== "yard");
  return [
    ["DXF: the file parses", true],
    ["DXF: units are inches", dxf.header?.$INSUNITS === 1],
    ["DXF: all 6 layers are in the layer table", Object.keys(LAYERS).every((l) => dxf.tables?.layer?.layers?.[l])],
    [`DXF: ${wrote("line", "WALLS")} wall lines read back`, count("LINE", "WALLS") === wrote("line", "WALLS")],
    [`DXF: ${lay.doors.length} doors, each a leaf and its swing`, count("ARC", "DOORS") === lay.doors.length && count("LINE", "DOORS") === lay.doors.length],
    [`DXF: ${lay.windows.length} windows read back`, count("LINE", "WINDOWS") === lay.windows.length],
    ["DXF: every room is labelled by name", rooms.every((r) => labels.includes(r.name))],
    [
      `DXF: the plot outline measures ${lay.plot[0] * 12} x ${lay.plot[1] * 12} in`,
      plotLines.length === 8 && Math.max(...plotLines.map((v) => v.x)) === lay.plot[0] * 12 && Math.max(...plotLines.map((v) => v.y)) === lay.plot[1] * 12,
    ],
    ["DXF: no zero-length lines", got.filter((e) => e.type === "LINE").every((e) => e.vertices[0].x !== e.vertices[1].x || e.vertices[0].y !== e.vertices[1].y)],
  ];
}

/** A small model can copy a plot from the tool's manual instead of the request, so the brief is checked too. */
function fromRequest(plot: string, message: string): boolean {
  const said: string[] = message.match(/\d+(?:\.\d+)?/g) ?? [];
  return ((plot.match(/\d+(?:\.\d+)?/g) ?? []) as string[]).every((n) => said.includes(n)) && (!/kanal/i.test(plot) || /kanal/i.test(message));
}

async function drawHousePlan(args: Args, ctx: ToolCtx): Promise<ToolResult> {
  const size = plotSize(String(args.plot ?? ""));
  if (typeof size === "string") return refuse(size);
  const [W, D] = size;
  const asked = Math.round(Number(args.bedrooms ?? 3));
  const storeys = Math.round(Number(args.storeys ?? 1));
  if (!(asked >= 1 && asked <= 8)) return refuse("ask for 1 to 8 bedrooms");
  const across = bedroomsAcross(W);
  if (asked > across && storeys < 2)
    return refuse(`a ${W} ft wide plot fits ${across} bedroom(s) side by side on one floor; ask for ${across}, or for 2 storeys and the rest go upstairs`);
  const onGround = Math.min(asked, across);

  const lay = plan({ plot: [W, D], bedrooms: onGround, storeys });
  if (!lay) return refuse(`a ${W}' x ${D}' plot is too shallow for a porch, a lounge, a passage and ${onGround} bedroom(s) with baths`);
  if (onGround < asked) lay.notes.push(`${asked - onGround} of the ${asked} bedrooms go on the upper floor, which is not drawn here`);

  // the sheet scale: the biggest standard one that fits A3, unless one was asked for
  let scale = SCALES.find((s) => fits(lay, s));
  if (args.scale) {
    const want = Number(String(args.scale).replace(/^\s*1\s*:\s*/, ""));
    if (!SCALES.includes(want)) return refuse(`1:${want} is not a standard scale; choose from ${SCALES.map((s) => "1:" + s).join(", ")}`);
    if (!fits(lay, want)) {
      const [nw, nh] = needs(lay, want);
      return refuse(`at 1:${want} the plan needs ${nw} x ${nh} mm and A3 has room for ${SHEET[0]} x ${SHEET[1]}; 1:${scale} fits A3, or ask for a bigger sheet`);
    }
    scale = want;
  }
  if (!scale) return refuse("the plot is too large for A3 at any standard scale");

  const marla = (W * D) / 225;
  const title = `GROUND FLOOR PLAN   ${W}' x ${D}' (${marla.toFixed(1)} marla)   1:${scale} on A3`;
  const ents = entities(lay, title);
  const dxf = toDxf(ents, lay);
  const svg = toSvg(ents, lay);

  const rooms = lay.rooms.filter((r) => r.kind !== "yard" && r.kind !== "passage");
  const covered = lay.rooms.filter((r) => r.kind !== "yard").reduce((s, r) => s + r.w * r.h, 0);
  const summary =
    `Ground floor plan for a ${W}' x ${D}' plot (${marla.toFixed(1)} marla), 1:${scale} on A3. Covered ${Math.round(covered).toLocaleString()} sq ft. ` +
    `Rooms: ${rooms.map((r) => `${r.name} ${feet(r.w)} x ${feet(r.h)}`).join("; ")}. ` +
    (lay.notes.length ? `Notes: ${lay.notes.join("; ")}. ` : "") +
    "Files: plan.dxf (AutoCAD), plan.svg, plan.json.";

  const [nw, nh] = needs(lay, scale);
  return result(
    summary,
    {
      dxf: outFile("plan.dxf", dxf, "application/dxf"),
      preview: outFile("plan.svg", svg, "image/svg+xml"),
      plan: outFile("plan.json", JSON.stringify(lay, null, 1), "application/json"), // the exact layout, for the next tool in a chain
    },
    [
      [`brief: the request itself says '${String(args.plot)}'`, fromRequest(String(args.plot), ctx.message)],
      ...checkPlan(lay),
      ...checkDxf(dxf, ents, lay),
      [`sheet: at 1:${scale} the plan needs ${nw} x ${nh} mm of A3's ${SHEET[0]} x ${SHEET[1]}`, fits(lay, scale)],
      ["sheet: the preview draws every entity the DXF holds", (svg.match(/<(line|path|text) /g) ?? []).length === ents.length],
    ],
    { preview: "preview", notes: [`searched ${lay.tried.toLocaleString()} candidate layouts, best score ${lay.score.toFixed(1)}`, ...lay.notes] },
  );
}

/** Rules lane: people say plots and bedrooms in a handful of ways. */
function rules(message: string): Args | null {
  const plot = message.match(/\d+(?:\.\d+)?\s*(?:marla|kanal)/i) ?? message.match(/\d+(?:\.\d+)?\s*[x×]\s*\d+(?:\.\d+)?\s*(?:ft|feet|foot|')/i);
  if (!plot) return null;
  const args: Args = { plot: plot[0] };
  const beds = message.match(/(\d+)\s*(?:bed(?:room)?s?)\b/i);
  args.bedrooms = beds ? Number(beds[1]) : 3;
  const storeys = message.match(/(\d)\s*(?:store?ys?|stories|floors?)\b/i);
  if (storeys) args.storeys = Number(storeys[1]);
  else if (/\bdouble[- ]store?y\b/i.test(message)) args.storeys = 2;
  const scale = message.match(/\b1\s*:\s*(\d{2,3})\b/);
  if (scale) args.scale = `1:${scale[1]}`;
  return args;
}

tool({
  name: "draw_house_plan",
  group: "cad",
  effect: "local",
  description:
    "Draw a ground floor plan as a DXF for AutoCAD, with an SVG preview at the sheet scale. plot: copied from the request, written as " +
    "'<n> marla', '<n> kanal' or '<w> x <d> ft'. bedrooms: how many. storeys: 1 or 2. scale: only if the request names one, like '1:100'. A layout search " +
    "places the rooms and doors, and the plan is checked before it is returned.",
  parameters: {
    type: "object",
    properties: {
      plot: { type: "string" },
      bedrooms: { type: "integer" },
      storeys: { type: "integer" },
      scale: { type: "string" },
    },
    required: ["plot", "bedrooms"],
  },
  fn: drawHousePlan,
  rules,
});

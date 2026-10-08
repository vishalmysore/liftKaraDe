// Layered composition as one tool: the model describes the poster, code writes the PSD and reads it back.
import { readPsd } from "ag-psd";
import { tool, type Args, type ToolCtx } from "../toolkit/registry";
import { outFile, refuse, result, type ToolResult } from "../toolkit/result";
import { flatten, writePsd, type Layer } from "./psd";

const PLACES = ["fill", "top-left", "top", "top-right", "left", "center", "right", "bottom-left", "bottom", "bottom-right", "above-center", "below-center"] as const;
type Place = (typeof PLACES)[number];

interface Spec {
  name: string;
  kind: "image" | "text";
  file?: string;
  text?: string;
  content?: string; // what the model writes: the file name of an image, or the words of a text layer
  at?: Place;
  color?: string;
}

const COLORS: Record<string, string> = {
  white: "#ffffff", black: "#111111", yellow: "#ffd60a", red: "#e63946", green: "#2a9d8f",
  blue: "#1d6fe0", orange: "#f77f00", pink: "#ff5d8f", gold: "#e9c46a", purple: "#7b2cbf",
};

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}

/** Built-in stand-ins so the demo runs with nothing attached. */
function sample(name: string): HTMLCanvasElement | null {
  if (/^shop\.(jpe?g|png)$/i.test(name)) {
    const [c, g] = canvas(1200, 1200);
    const sky = g.createLinearGradient(0, 0, 1200, 1200);
    sky.addColorStop(0, "#0f3d3e");
    sky.addColorStop(0.55, "#1f6f5c");
    sky.addColorStop(1, "#c8553d");
    g.fillStyle = sky;
    g.fillRect(0, 0, 1200, 1200);
    g.globalAlpha = 0.16;
    g.fillStyle = "#ffe8b0";
    for (let i = 0; i < 9; i++) {
      g.beginPath();
      g.arc(150 + i * 130, 170 + ((i * 97) % 220), 34 + ((i * 53) % 60), 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 0.28;
    g.fillStyle = "#0b1f20";
    g.fillRect(0, 900, 1200, 300); // the shop counter
    for (let i = 0; i < 6; i++) g.fillRect(80 + i * 190, 700 - ((i * 71) % 120), 120, 200 + ((i * 71) % 120)); // shelves
    return c;
  }
  if (/^logo\.(png|svg|jpe?g)$/i.test(name)) {
    const [c, g] = canvas(400, 400);
    g.fillStyle = "#ffd60a";
    g.beginPath();
    g.arc(200, 200, 190, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#0f3d3e";
    g.font = "bold 150px system-ui, 'Segoe UI', Arial, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("LK", 200, 212);
    return c;
  }
  return null;
}

async function picture(name: string, ctx: ToolCtx): Promise<CanvasImageSource & { width: number; height: number }> {
  const blob = ctx.files.get(name);
  if (blob) return await createImageBitmap(blob);
  const s = sample(name);
  if (s) return s;
  throw new Error(`no file named ${name} is attached (the built-in samples are shop.jpg and logo.png)`);
}

function anchor(at: Place, bw: number, bh: number, W: number, H: number): [number, number] {
  const m = Math.round(W * 0.05);
  const x = at.endsWith("left") ? m : at.endsWith("right") ? W - m - bw : (W - bw) / 2;
  let y = (H - bh) / 2;
  if (at.startsWith("top")) y = m;
  else if (at.startsWith("bottom")) y = H - m - bh;
  else if (at === "above-center") y = H / 2 - 0.1 * H - bh;
  else if (at === "below-center") y = H / 2 + 0.1 * H;
  return [Math.round(x), Math.round(y)];
}

/** Draw one layer on a transparent canvas the size of the poster, then crop it to the pixels it uses. */
async function placeLayer(spec: Spec, W: number, H: number, ctx: ToolCtx): Promise<Layer> {
  const [, g] = canvas(W, H);
  const at = PLACES.includes(spec.at as Place) ? (spec.at as Place) : spec.kind === "image" ? "fill" : "center";
  if (spec.kind === "image") {
    const im = await picture(spec.file ?? spec.content ?? "", ctx);
    if (at === "fill") {
      const k = Math.max(W / im.width, H / im.height); // cover the poster
      g.drawImage(im, (W - im.width * k) / 2, (H - im.height * k) / 2, im.width * k, im.height * k);
    } else {
      const k = Math.min((W * 0.2) / im.width, (H * 0.2) / im.height); // a logo: a fifth of the poster
      const [bw, bh] = [im.width * k, im.height * k];
      const [x, y] = anchor(at, bw, bh, W, H);
      g.drawImage(im, x, y, bw, bh);
    }
  } else {
    const text = spec.text ?? spec.content ?? "";
    let px = Math.round(W * (at === "center" ? 0.15 : 0.075));
    g.font = `bold ${px}px system-ui, 'Segoe UI', Arial, sans-serif`;
    const fit = (W * 0.9) / g.measureText(text).width;
    if (fit < 1) px = Math.floor(px * fit); // the text never leaves the poster
    g.font = `bold ${px}px system-ui, 'Segoe UI', Arial, sans-serif`;
    g.fillStyle = COLORS[(spec.color ?? "white").toLowerCase()] ?? spec.color ?? "#ffffff";
    g.textBaseline = "top";
    const [x, y] = anchor(at, g.measureText(text).width, px, W, H);
    g.fillText(text, x, y);
  }
  const all = g.getImageData(0, 0, W, H).data;
  let [x0, y0, x1, y1] = [W, H, -1, -1];
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (all[(y * W + x) * 4 + 3]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  if (x1 < 0) throw new Error(`layer "${spec.name}" came out empty`);
  const [w, h] = [x1 - x0 + 1, y1 - y0 + 1];
  return { name: spec.name, data: g.getImageData(x0, y0, w, h).data, w, h, left: x0, top: y0 };
}

/** The verifier: reopen the saved bytes with ag-psd, which knows nothing about our writer. */
function check(bytes: Uint8Array, W: number, H: number, placed: Layer[]): Array<[string, boolean]> {
  const psd = readPsd(bytes.buffer as ArrayBuffer, { useImageData: true });
  const kids = psd.children ?? [];
  const boxes =
    kids.length === placed.length &&
    placed.every((l, i) => {
      const k = kids[i];
      return k.name === l.name && k.left === l.left && k.top === l.top && k.right === l.left + l.w && k.bottom === l.top + l.h;
    });
  // restack the layers ag-psd decoded and compare with the flattened picture stored in the file
  const reread: Layer[] = kids.map((k) => ({
    name: k.name ?? "",
    data: k.imageData!.data as Uint8ClampedArray,
    w: k.imageData!.width,
    h: k.imageData!.height,
    left: k.left ?? 0,
    top: k.top ?? 0,
  }));
  const stacked = flatten(W, H, reread);
  const stored = psd.imageData?.data;
  let same = Boolean(stored) && stored!.length === stacked.length;
  for (let i = 0; same && i < stacked.length; i += 4)
    same = stacked[i] === stored![i] && stacked[i + 1] === stored![i + 1] && stacked[i + 2] === stored![i + 2];
  return [
    [`the file reopens as ${W}x${H} RGB`, psd.width === W && psd.height === H],
    [`ag-psd reads all ${placed.length} layers by name, each in its place`, boxes],
    ["the flattened picture is the layers stacked, pixel for pixel", same],
  ];
}

/** Asked versus delivered: every file and every quoted phrase in the request has to be on a layer. */
function checkBrief(message: string, specs: Spec[]): Array<[string, boolean]> {
  const files = message.match(/[\w-]+\.(?:jpe?g|png|webp|svg)\b/gi) ?? [];
  const words = [...message.matchAll(/['"“‘]([^'"”’]+)['"”’]/g)].map((m) => m[1]);
  const out: Array<[string, boolean]> = [];
  if (files.length) out.push([`brief: every file the request names is a layer (${files.join(", ")})`, files.every((f) => specs.some((s) => (s.file ?? s.content) === f))]);
  if (words.length) out.push([`brief: every quoted phrase is a text layer (${words.join(", ")})`, words.every((w) => specs.some((s) => s.kind === "text" && (s.text ?? s.content) === w))]);
  return out;
}

async function composeLayeredImage(args: Args, ctx: ToolCtx): Promise<ToolResult> {
  const [W, H] = [Math.round(Number(args.width ?? 1080)), Math.round(Number(args.height ?? 1080))];
  if (!(W >= 64 && H >= 64 && W <= 4096 && H <= 4096)) return refuse(`a ${W}x${H} canvas is outside 64 to 4096 pixels`);
  const specs = (args.layers as Spec[] | undefined) ?? [];
  if (!specs.length) return refuse("the poster needs at least one layer");
  const name = String(args.name ?? "poster");
  const slug = name.replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "poster";

  const placed: Layer[] = [];
  for (const s of specs) placed.push(await placeLayer(s, W, H, ctx));
  const { bytes, flat } = writePsd(W, H, placed);

  const [c, g] = canvas(W, H);
  g.putImageData(new ImageData(flat as Uint8ClampedArray<ArrayBuffer>, W, H), 0, 0);
  const png = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));

  return result(
    `PSD with ${placed.length} layers (${placed.map((l) => l.name).join(", ")}), ${W}x${H}: ${slug}.psd and a PNG preview. ` +
      "Opens in Photoshop, GIMP, Photopea and Affinity with every layer movable.",
    { psd: outFile(`${slug}.psd`, bytes as Uint8Array<ArrayBuffer>, "image/vnd.adobe.photoshop"), preview: outFile(`${slug}.png`, png, "image/png") },
    [...checkBrief(ctx.message, specs), ...check(bytes, W, H, placed)],
    { preview: "preview" },
  );
}

/** Rules lane for requests written like: "photoshop file 1080x1080: background shop.jpg; logo logo.png top-left; title 'Eid Sale' white". */
function rules(message: string): Args | null {
  const size = message.match(/(\d{3,4})\s*[x×]\s*(\d{3,4})/);
  const body = message.includes(":") ? message.slice(message.indexOf(":") + 1) : message;
  const layers: Spec[] = [];
  let title = "";
  for (const part of body.split(";").map((p) => p.trim())) {
    let m: RegExpMatchArray | null;
    if ((m = part.match(/^background\s+(\S+\.\w+)/i))) layers.push({ name: "Background", kind: "image", file: m[1], at: "fill" });
    else if ((m = part.match(/^logo\s+(\S+\.\w+)(?:\s+([a-z-]+))?/i)))
      layers.push({ name: "Logo", kind: "image", file: m[1], at: (PLACES.includes(m[2] as Place) ? m[2] : "top-left") as Place });
    else if ((m = part.match(/^(title|subtitle|text)\s+['"“‘](.+?)['"”’](?:\s+(#?\w+))?/i))) {
      const kind = m[1].toLowerCase();
      if (kind === "title") title = m[2];
      layers.push({
        name: kind[0].toUpperCase() + kind.slice(1),
        kind: "text",
        text: m[2],
        color: m[3] ?? "white",
        at: kind === "title" ? "center" : kind === "subtitle" ? "below-center" : "bottom",
      });
    }
  }
  if (!layers.length) return null;
  return { width: size ? Number(size[1]) : 1080, height: size ? Number(size[2]) : 1080, name: title || "poster", layers };
}

tool({
  name: "compose_layered_image",
  group: "apps",
  effect: "local",
  description:
    "Make a layered PSD that opens in Photoshop, GIMP, Photopea and Affinity with every layer movable. " +
    "width, height: pixels. layers: one per thing in the request, bottom first: the background image, then other images, then text. " +
    'Each layer: "name": a short label; "kind": "image" or "text"; "content": the file name for an image, or the exact words for text; ' +
    '"at": "fill" for a background image, a corner like "top-left" for a logo, "center" for a title, "below-center" for a subtitle; ' +
    '"color": the text colour. Returns the PSD, a PNG preview and checks read back from the saved file.',
  parameters: {
    type: "object",
    properties: {
      width: { type: "integer" },
      height: { type: "integer" },
      name: { type: "string" },
      layers: {
        type: "array",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            kind: { type: "string", enum: ["image", "text"] },
            content: { type: "string" },
            at: { type: "string", enum: [...PLACES] },
            color: { type: "string" },
          },
          required: ["name", "kind", "content", "at"],
        },
      },
    },
    required: ["width", "height", "name", "layers"],
  },
  fn: composeLayeredImage,
  rules,
});

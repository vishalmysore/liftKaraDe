// The layout search: rooms in bands from the road back, each candidate sized, scored and walked through its doors.
// All lengths are in feet. The road is at y = 0 and the plot runs back to y = depth.

export type Kind = "porch" | "drawing" | "kitchen" | "lounge" | "stairs" | "passage" | "bed" | "bath" | "yard";

export interface Room {
  id: string;
  name: string;
  kind: Kind;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Door {
  a: string;
  b: string;
  x: number; // the middle of the opening
  y: number;
  wall: "h" | "v"; // the wall it sits in runs along x (h) or along y (v)
}
export interface Win {
  room: string;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface Layout {
  plot: [number, number];
  setback: number;
  bedrooms: number;
  storeys: number;
  rooms: Room[];
  doors: Door[];
  windows: Win[];
  score: number;
  notes: string[];
  unreachable: string[];
  tried: number;
}

export const SETBACK = 5; // open strip between the road and the house
export const PASSAGE = 4;
export const DOOR = 3;
const MIN_SHARED = 3.5; // two rooms need this much common wall to get a door
export const MIN_WIDTH: Record<Kind, number> = { porch: 9, drawing: 10, kitchen: 7, lounge: 9, stairs: 6, passage: 3.5, bed: 9.5, bath: 4.5, yard: 0 };
const TARGET: Partial<Record<Kind, number>> = { porch: 180, drawing: 230, kitchen: 110, lounge: 220, stairs: 80, bed: 150, bath: 40 };

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A door between two rooms that share enough wall, in the middle of what they share. */
export function connect(a: Room, b: Room): Door | null {
  for (const [p, q] of [[a, b], [b, a]]) {
    if (near(p.y + p.h, q.y)) {
      const [lo, hi] = [Math.max(p.x, q.x), Math.min(p.x + p.w, q.x + q.w)];
      if (hi - lo >= MIN_SHARED) return { a: a.id, b: b.id, x: (lo + hi) / 2, y: q.y, wall: "h" };
    }
    if (near(p.x + p.w, q.x)) {
      const [lo, hi] = [Math.max(p.y, q.y), Math.min(p.y + p.h, q.y + q.h)];
      if (hi - lo >= MIN_SHARED) return { a: a.id, b: b.id, x: q.x, y: (lo + hi) / 2, wall: "v" };
    }
  }
  return null;
}

/** Every room you can walk to from the car porch. */
export function reachable(rooms: Room[], doors: Door[]): Set<string> {
  const seen = new Set<string>(["porch"]);
  const queue = ["porch"];
  while (queue.length) {
    const at = queue.pop()!;
    for (const d of doors) {
      const next = d.a === at ? d.b : d.b === at ? d.a : null;
      if (next && !seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return new Set(rooms.filter((r) => seen.has(r.id)).map((r) => r.id));
}

/** How many bedrooms fit side by side across the back of the plot. */
export const bedroomsAcross = (width: number) => Math.floor(width / MIN_WIDTH.bed);

function candidate(W: number, D: number, beds: number, storeys: number, rng: () => number): Layout | null {
  const q = (lo: number, hi: number) => lo + Math.round(rng() * (hi - lo) * 2) / 2; // on a 6 inch grid
  const y0 = SETBACK;
  const [front, middle, bathD] = [q(10, 20), q(9, 18), q(4.5, 8)];
  const bedD = D - y0 - front - middle - PASSAGE - bathD;
  if (bedD < MIN_WIDTH.bed) return null;

  const rooms: Room[] = [];
  const add = (id: string, name: string, kind: Kind, x: number, y: number, w: number, h: number) => {
    const r = { id, name, kind, x, y, w, h };
    rooms.push(r);
    return r;
  };

  // front band: car porch and drawing room
  const porchW = q(10, 14);
  if (W - porchW < MIN_WIDTH.drawing) return null;
  const porchLeft = rng() < 0.5;
  const porch = add("porch", "Car Porch", "porch", porchLeft ? 0 : W - porchW, y0, porchW, front);
  const drawing = add("drawing", "Drawing Room", "drawing", porchLeft ? porchW : 0, y0, W - porchW, front);

  // middle band: kitchen, TV lounge and stairs, in any order
  const widths: Record<string, number> = { kitchen: q(8, 12), stairs: q(6, 9) };
  widths.lounge = W - widths.kitchen - widths.stairs;
  if (widths.lounge < MIN_WIDTH.lounge) return null;
  const order = ["kitchen", "lounge", "stairs"].sort(() => rng() - 0.5);
  const names: Record<string, string> = { kitchen: "Kitchen", lounge: "TV Lounge", stairs: "Stairs" };
  let x = 0;
  const mid: Record<string, Room> = {};
  for (const id of order) {
    mid[id] = add(id, names[id], id as Kind, x, y0 + front, widths[id], middle);
    x += widths[id];
  }

  const passage = add("passage", "Passage", "passage", 0, y0 + front + middle, W, PASSAGE);

  // back band: bedrooms side by side, each with a bath behind it and an open yard beside the bath
  const yb = passage.y + PASSAGE;
  const bedRooms: Array<[Room, Room, Room]> = [];
  x = 0;
  for (let i = 0; i < beds; i++) {
    const w = i < beds - 1 ? Math.round((W / beds + q(-1.5, 1.5)) * 2) / 2 : W - x;
    if (w < MIN_WIDTH.bed) return null;
    const bathW = Math.min(q(5, 7), w - 3);
    const bathLeft = rng() < 0.5;
    const bed = add(`bed${i + 1}`, `Bed Room ${i + 1}`, "bed", x, yb, w, bedD);
    const bath = add(`bath${i + 1}`, `Bath ${i + 1}`, "bath", bathLeft ? x : x + w - bathW, yb + bedD, bathW, bathD);
    const yard = add(`yard${i + 1}`, "Open", "yard", bathLeft ? x + bathW : x, yb + bedD, w - bathW, bathD);
    bedRooms.push([bed, bath, yard]);
    x += w;
  }

  // doors, and penalty points for the ones a good plan would have
  const doors: Door[] = [];
  let score = 0;
  const link = (a: Room, b: Room) => {
    const d = connect(a, b);
    if (d) doors.push(d);
    return Boolean(d);
  };
  link(porch, drawing);
  if (!link(drawing, mid.lounge)) score += link(porch, mid.lounge) ? 3 : 10; // guests should reach the lounge through the drawing room
  if (!link(mid.lounge, mid.kitchen)) {
    link(mid.kitchen, passage);
    score += 4; // a kitchen off the lounge serves better than one off the passage
  }
  if (!link(mid.lounge, mid.stairs)) link(mid.stairs, passage);
  link(mid.lounge, passage);
  for (const [bed, bath] of bedRooms) {
    link(passage, bed);
    link(bed, bath);
  }

  const walked = reachable(rooms, doors);
  const unreachable = rooms.filter((r) => r.kind !== "yard" && !walked.has(r.id)).map((r) => r.name);
  score += 40 * unreachable.length; // a room nobody can walk to

  // daylight and windows: the front and back are open; side walls are shared with neighbours on plots under 50 ft
  const sidesOpen = W >= 50;
  const windows: Win[] = [];
  const notes: string[] = [];
  const dw = Math.min(5, drawing.w - 2);
  windows.push({ room: "drawing", x1: drawing.x + (drawing.w - dw) / 2, y1: y0, x2: drawing.x + (drawing.w + dw) / 2, y2: y0 });
  for (const [bed, , yard] of bedRooms) {
    if (yard.w >= 3) {
      const ww = Math.min(4, yard.w - 1);
      windows.push({ room: bed.id, x1: yard.x + (yard.w - ww) / 2, y1: yard.y, x2: yard.x + (yard.w + ww) / 2, y2: yard.y });
    } else {
      score += 5;
      notes.push(`${bed.name.toUpperCase()} has no outside wall: widen the yard behind it`);
    }
  }
  for (const r of [mid.kitchen, mid.lounge]) {
    const side = sidesOpen && near(r.x, 0) ? 0 : sidesOpen && near(r.x + r.w, W) ? W : null;
    if (side !== null) windows.push({ room: r.id, x1: side, y1: r.y + r.h / 2 - 2, x2: side, y2: r.y + r.h / 2 + 2 });
    else {
      score += 5;
      notes.push(`${r.name.toUpperCase()} has no outside wall: give it a skylight or a ventilator` + (r.kind === "kitchen" ? " and an exhaust fan" : ""));
    }
  }

  // sizes: far from the target area, or shaped like a corridor
  for (const r of rooms) {
    const target = TARGET[r.kind];
    if (target) score += (Math.abs(r.w * r.h - target) / target) * (r.kind === "bed" ? 12 : 8);
    const slim = Math.max(r.w, r.h) / Math.min(r.w, r.h);
    if (slim > 2 && r.kind !== "passage" && r.kind !== "yard") score += (slim - 2) * 8;
  }
  if (beds < storeys) notes.push("the upper floor is not drawn here");

  return { plot: [W, D], setback: SETBACK, bedrooms: beds, storeys, rooms, doors, windows, score, notes, unreachable, tried: 0 };
}

/** Keep the best of a fixed number of candidates. The seed is fixed, so the same brief draws the same plan. */
export function plan(spec: { plot: [number, number]; bedrooms: number; storeys: number }, tries = 6000): Layout | null {
  const rng = mulberry32(spec.plot[0] * 1000 + spec.plot[1] * 10 + spec.bedrooms);
  let best: Layout | null = null;
  for (let i = 0; i < tries; i++) {
    const c = candidate(spec.plot[0], spec.plot[1], spec.bedrooms, spec.storeys, rng);
    if (c && (!best || c.score < best.score)) best = c;
  }
  if (best) best.tried = tries;
  return best;
}

// A PSD written byte by byte: header, one record per layer, raw channel pixels, then the flattened picture.
export interface Layer {
  name: string;
  data: Uint8ClampedArray; // RGBA, w * h * 4
  w: number;
  h: number;
  left: number;
  top: number;
}

class Bytes {
  private chunks: Uint8Array[] = [];
  length = 0;

  push(b: Uint8Array): this {
    this.chunks.push(b);
    this.length += b.length;
    return this;
  }
  private num(size: number, set: (d: DataView) => void): this {
    const b = new Uint8Array(size);
    set(new DataView(b.buffer));
    return this.push(b);
  }
  u8(...v: number[]): this {
    return this.push(Uint8Array.from(v));
  }
  u16(v: number): this {
    return this.num(2, (d) => d.setUint16(0, v));
  }
  i16(v: number): this {
    return this.num(2, (d) => d.setInt16(0, v));
  }
  u32(v: number): this {
    return this.num(4, (d) => d.setUint32(0, v));
  }
  i32(v: number): this {
    return this.num(4, (d) => d.setInt32(0, v));
  }
  ascii(s: string): this {
    return this.push(Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff));
  }
  done(): Uint8Array {
    const out = new Uint8Array(this.length);
    let at = 0;
    for (const c of this.chunks) {
      out.set(c, at);
      at += c.length;
    }
    return out;
  }
}

/** The layer's name as a Pascal string, padded to a multiple of 4 bytes. */
function pascal(name: string): Uint8Array {
  const s = name.replace(/[^\x20-\x7e]/g, "?").slice(0, 255);
  const b = new Bytes().u8(s.length).ascii(s);
  while (b.length % 4) b.u8(0);
  return b.done();
}

/** The same name again in a 'luni' block, which is where Photoshop reads names from. */
function unicodeName(name: string): Uint8Array {
  const b = new Bytes().ascii("8BIMluni").u32(4 + 2 * name.length).u32(name.length);
  for (const ch of name) b.u16(ch.charCodeAt(0));
  return b.done();
}

/** Stack the layers on white, bottom first. Integer maths, so a reader can reproduce it exactly. */
export function flatten(width: number, height: number, layers: Layer[]): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const l of layers) {
    for (let y = 0; y < l.h; y++) {
      const cy = l.top + y;
      if (cy < 0 || cy >= height) continue;
      for (let x = 0; x < l.w; x++) {
        const cx = l.left + x;
        if (cx < 0 || cx >= width) continue;
        const s = (y * l.w + x) * 4;
        const d = (cy * width + cx) * 4;
        const a = l.data[s + 3];
        if (!a) continue;
        for (let c = 0; c < 3; c++) out[d + c] = ((l.data[s + c] * a + out[d + c] * (255 - a) + 127) / 255) | 0;
      }
    }
  }
  return out;
}

function plane(rgba: Uint8ClampedArray, channel: number): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + channel];
  return out;
}

/** layers: bottom first. Writes an 8-bit RGB PSD and returns it with the flattened picture (RGBA). */
export function writePsd(width: number, height: number, layers: Layer[]): { bytes: Uint8Array; flat: Uint8ClampedArray } {
  const records = new Bytes();
  const channels = new Bytes();
  for (const l of layers) {
    const ids = [-1, 0, 1, 2]; // channel -1 is the layer's transparency
    records.i32(l.top).i32(l.left).i32(l.top + l.h).i32(l.left + l.w).u16(4); // the layer's box and its 4 channels
    for (const id of ids) records.i16(id).u32(2 + l.w * l.h); // each channel: a 2-byte header + raw pixels
    const extra = new Bytes().u32(0).u32(0).push(pascal(l.name)).push(unicodeName(l.name)).done(); // no mask, no blend ranges
    records.ascii("8BIMnorm").u8(255, 0, 0, 0).u32(extra.length).push(extra); // normal blend, fully opaque
    for (const id of ids) channels.u16(0).push(plane(l.data, id < 0 ? 3 : id)); // 0 = raw pixels
  }
  const info = new Bytes().i16(layers.length).push(records.done()).push(channels.done());
  if (info.length % 2) info.u8(0); // this section has to end on an even length
  const layerInfo = info.done();
  const lmi = new Bytes().u32(layerInfo.length).push(layerInfo).u32(0).done(); // layer info, then an empty global mask

  const flat = flatten(width, height, layers);
  const out = new Bytes()
    .ascii("8BPS").u16(1).push(new Uint8Array(6)).u16(3).u32(height).u32(width).u16(8).u16(3) // version 1, 3 channels, 8 bits, RGB
    .u32(0).u32(0) // no colour table, no resources
    .u32(lmi.length).push(lmi)
    .u16(0); // the flattened picture follows, raw, plane by plane
  for (let c = 0; c < 3; c++) out.push(plane(flat, c));
  return { bytes: out.done(), flat };
}

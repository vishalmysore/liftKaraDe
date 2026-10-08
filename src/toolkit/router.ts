// Rules-first shortlist: regex signals decide which tool groups go into the prompt.
// A small in-browser model has a ~4k context, so this is not an optimisation here, it is a requirement.

type Signal = [RegExp, number];

export const SIGNALS: Record<string, Signal[]> = {
  apps: [
    [/\bphotoshop\b|\bpsd\b|\bgimp\b|\bphotopea\b/i, 12], // naming a program is worth 12
    [/\bposter\b|\bbanner\b|\bflyer\b|\blayers?\b|\blayered\b/i, 7],
  ],
  cad: [
    [/\bhouse plan\b|\bfloor plan\b|\bmarla\b|\bkanal\b|\bautocad\b|\bdxf\b/i, 7],
    [/\bbedrooms?\b|\bbeds?\b|\bstore?y\b|\bplot\b/i, 5],
    [/\b1\s*:\s*\d{2,3}\b/, 4],
  ],
};

export const CLEAR_SCORE = 5;
export const CLEAR_LEAD = 1.5;

export interface Shortlist {
  scores: Array<[group: string, score: number]>;
  clear: boolean;
  groups: string[];
}

export function score(message: string): Record<string, number> {
  const s: Record<string, number> = {};
  for (const [group, sigs] of Object.entries(SIGNALS)) {
    const hits = sigs.filter(([pat]) => pat.test(message)).map(([, w]) => w).sort((a, b) => b - a);
    if (hits.length) s[group] = hits[0] + 0.5 * (hits.length - 1); // the strongest signal, plus a little for each extra
  }
  return s;
}

export function shortlist(message: string): Shortlist {
  const scores = Object.entries(score(message)).sort((a, b) => b[1] - a[1]);
  if (!scores.length) return { scores, clear: false, groups: [] };
  const [top, next] = [scores[0][1], scores[1]?.[1] ?? 0];
  const clear = top >= CLEAR_SCORE && top - next >= CLEAR_LEAD;
  return { scores, clear, groups: clear ? [scores[0][0]] : scores.slice(0, 3).map(([g]) => g) };
}

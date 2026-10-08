// The only thing a tool sends back: a short summary, files, and the checks it ran on its own output.
export interface OutFile {
  name: string;
  url: string; // blob URL, so the file downloads and opens in the real program
  mime: string;
}

export type Check = [name: string, passed: boolean];

export interface ToolResult {
  ok: boolean;
  summary: string;
  files: Record<string, OutFile>;
  checks: Check[];
  preview?: string; // key in files of a picture to show
  refused?: string; // a refusal is a result too: the reason, in plain words
  notes?: string[];
}

export function outFile(name: string, data: BlobPart, mime: string): OutFile {
  return { name, url: URL.createObjectURL(new Blob([data], { type: mime })), mime };
}

export function result(
  summary: string,
  files: Record<string, OutFile> = {},
  checks: Array<[string, unknown]> = [],
  extra: Partial<ToolResult> = {},
): ToolResult {
  const done: Check[] = checks.map(([name, passed]) => [name, Boolean(passed)]);
  return { ok: done.every(([, p]) => p), summary, files, checks: done, ...extra };
}

export function refuse(reason: string): ToolResult {
  return { ok: false, summary: `Couldn't do that: ${reason}`, files: {}, checks: [], refused: reason };
}

/** What goes back into a model prompt: a few hundred tokens of JSON, never a picture. */
export function asText(r: ToolResult): string {
  return JSON.stringify({
    ok: r.ok,
    summary: r.summary,
    files: Object.fromEntries(Object.entries(r.files).map(([k, f]) => [k, f.name])),
    checks: r.checks,
    ...(r.refused ? { refused: r.refused } : {}),
  });
}

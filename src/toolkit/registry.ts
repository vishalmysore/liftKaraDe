// What the model sees of the "computer", and what runs when it calls.
import type { ToolResult } from "./result";

export type Effect = "local" | "outward"; // "outward" tools wait for a yes
export type Args = Record<string, unknown>;
export type JsonSchema = Record<string, unknown>;

export interface ToolCtx {
  message: string;
  files: Map<string, Blob>; // files attached to the request, by name
}

export interface Tool {
  name: string;
  group: string; // the shortlist puts whole groups in the prompt
  description: string; // the tool's manual: all the model ever learns about it
  parameters: JsonSchema;
  effect: Effect;
  fn: (args: Args, ctx: ToolCtx) => Promise<ToolResult>;
  /** Rules-first lane: fill the arguments without a model, or null when the rules cannot tell. */
  rules?: (message: string, ctx: ToolCtx) => Args | null;
}

export const TOOLS = new Map<string, Tool>();

export function tool(t: Tool): Tool {
  TOOLS.set(t.name, t);
  return t;
}

export function toolsIn(groups: string[]): Tool[] {
  return [...TOOLS.values()].filter((t) => groups.includes(t.group));
}

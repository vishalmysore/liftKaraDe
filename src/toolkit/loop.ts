// Rules shortlist the tools, rules or the model fill the arguments, the tool acts and checks, text comes back.
import type { Model } from "../llm/engine";
import { TOOLS, toolsIn, type Args, type Tool, type ToolCtx } from "./registry";
import { asText, refuse, type ToolResult } from "./result";
import { shortlist } from "./router";

export interface Trace {
  kind: "route" | "rules" | "model" | "tool" | "reply";
  text: string;
  seconds?: number;
}

export interface Run {
  reply: string;
  result?: ToolResult;
  toolName?: string;
  modelCalls: number;
  toolCalls: number;
  inputTokens: number;
  seconds: number;
}

const SYSTEM =
  "You turn a request into ONE tool call. Reply with a single JSON object " +
  '{"tool": <name>, "args": {...}} and nothing else. Use only values the request gives; leave optional arguments out otherwise.';

function prompt(tools: Tool[]): string {
  return SYSTEM + "\n\nTools:\n" + tools.map((t) => `- ${t.name}: ${t.description}`).join("\n");
}

/** The reply grammar: only the shortlisted tools, each with its own argument schema. */
function callSchema(tools: Tool[]) {
  const one = (t: Tool) => ({
    type: "object",
    properties: { tool: { type: "string", enum: [t.name] }, args: t.parameters },
    required: ["tool", "args"],
  });
  return tools.length === 1 ? one(tools[0]) : { anyOf: tools.map(one) };
}

export async function runAgent(
  request: string,
  files: Map<string, Blob>,
  opts: { model?: Model; rulesFirst: boolean },
  trace: (t: Trace) => void,
): Promise<Run> {
  const t0 = performance.now();
  const run: Run = { reply: "", modelCalls: 0, toolCalls: 0, inputTokens: 0, seconds: 0 };
  const finish = (reply: string): Run => {
    run.reply = reply;
    run.seconds = (performance.now() - t0) / 1000;
    trace({ kind: "reply", text: reply });
    return run;
  };
  const ctx: ToolCtx = { message: request, files };

  const sl = shortlist(request);
  const tools = toolsIn(sl.groups);
  const schemaChars = tools.reduce((n, t) => n + JSON.stringify(t.parameters).length + t.description.length, 0);
  trace({
    kind: "route",
    text: sl.scores.length
      ? `${sl.scores.map(([g, s]) => `${g} ${s.toFixed(1)}`).join("   ")}  ->  ${sl.clear ? "clear" : "not clear"}: ` +
        `${tools.length} of ${TOOLS.size} tools in the prompt (~${Math.round(schemaChars / 4)} schema tokens)`
      : "no group scores",
  });
  if (!tools.length) return finish("None of my tools fits that yet. Try a layered Photoshop poster or a house plan.");

  let call: { tool: Tool; args: Args } | null = null;

  if (opts.rulesFirst) {
    for (const t of tools) {
      const args = t.rules?.(request, ctx);
      if (args) {
        call = { tool: t, args };
        trace({ kind: "rules", text: `${t.name}(${JSON.stringify(args)})`, seconds: 0 });
        break;
      }
    }
    if (!call) trace({ kind: "rules", text: "the rules cannot fill the arguments" + (opts.model ? ", asking the model" : "") });
  }

  if (!call) {
    if (!opts.model) return finish("The rules could not read that request. Load a model so it can fill in the arguments.");
    const user = request + (files.size ? `\nAttached files: ${[...files.keys()].join(", ")}` : "");
    const answer = await opts.model.json(prompt(tools), user, callSchema(tools));
    run.modelCalls += 1;
    run.inputTokens += answer.inputTokens;
    trace({ kind: "model", text: `in ${answer.inputTokens} tok, out ${answer.outputTokens} tok  ->  ${answer.text}`, seconds: answer.seconds });
    try {
      const parsed = JSON.parse(answer.text) as { tool: string; args: Args };
      const t = tools.find((x) => x.name === parsed.tool);
      if (t) call = { tool: t, args: parsed.args ?? {} };
    } catch {
      /* falls through to the reply below */
    }
    if (!call) return finish("The model did not return a usable tool call.");
  }

  const tt = performance.now();
  let out: ToolResult;
  try {
    out = await call.tool.fn(call.args, ctx);
  } catch (e) {
    out = refuse(e instanceof Error ? e.message : String(e));
  }
  run.toolCalls += 1;
  run.result = out;
  run.toolName = call.tool.name;
  const passed = out.checks.filter(([, p]) => p).length;
  trace({
    kind: "tool",
    text: out.refused ? `refused: ${out.refused}` : `${out.ok ? "ok" : "FAILED"}, ${passed}/${out.checks.length} checks  (${asText(out).length} chars of JSON back)`,
    seconds: (performance.now() - tt) / 1000,
  });

  // The reply is templated from the checked result: no second model call just to rephrase it.
  const failed = out.checks.filter(([, p]) => !p).map(([name]) => name);
  return finish(
    out.summary + (out.checks.length ? ` (checked ${passed}/${out.checks.length})` : "") + (failed.length ? ` NOT RIGHT YET: ${failed.join("; ")}.` : ""),
  );
}

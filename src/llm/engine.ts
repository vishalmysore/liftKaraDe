// The model client: one WebLLM engine in a worker, asked for JSON that a grammar guarantees is valid.
import { CreateWebWorkerMLCEngine, prebuiltAppConfig, type MLCEngineInterface } from "@mlc-ai/web-llm";
import type { JsonSchema } from "../toolkit/registry";

// Small instruct models that follow a JSON schema well. q4f32 first: f16 shaders misbehave on some integrated GPUs.
const WANTED = /^(Qwen2\.5-(0\.5|1\.5|3)B-Instruct|Hermes-3-Llama-3\.2-3B|Llama-3\.2-3B-Instruct|Phi-3\.5-mini-instruct)-q4f(32|16)_1-MLC$/;
const PREFERRED = ["Qwen2.5-3B-Instruct-q4f32_1-MLC", "Hermes-3-Llama-3.2-3B-q4f32_1-MLC", "Qwen2.5-1.5B-Instruct-q4f32_1-MLC"];

export function modelChoices(): { ids: string[]; preferred: string } {
  const ids = prebuiltAppConfig.model_list.map((m) => m.model_id).filter((id) => WANTED.test(id));
  ids.sort((a, b) => Number(b.includes("q4f32")) - Number(a.includes("q4f32")) || a.localeCompare(b));
  return { ids, preferred: PREFERRED.find((p) => ids.includes(p)) ?? ids[0] };
}

export const hasWebGPU = (): boolean => "gpu" in navigator;

export interface Answer {
  text: string;
  inputTokens: number;
  outputTokens: number;
  seconds: number;
}

export class Model {
  private constructor(
    private engine: MLCEngineInterface,
    readonly id: string,
  ) {}

  static async load(id: string, onProgress: (text: string, fraction: number) => void): Promise<Model> {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const engine = await CreateWebWorkerMLCEngine(worker, id, {
      initProgressCallback: (p) => onProgress(p.text, p.progress),
    });
    return new Model(engine, id);
  }

  /** One model call. The schema is enforced while decoding, so the reply always parses. */
  async json(system: string, user: string, schema: JsonSchema): Promise<Answer> {
    const t0 = performance.now();
    const reply = await this.engine.chat.completions.create({
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature: 0,
      max_tokens: 700,
      response_format: { type: "json_object", schema: JSON.stringify(schema) },
    });
    return {
      text: reply.choices[0].message.content ?? "",
      inputTokens: reply.usage?.prompt_tokens ?? 0,
      outputTokens: reply.usage?.completion_tokens ?? 0,
      seconds: (performance.now() - t0) / 1000,
    };
  }
}

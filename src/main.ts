import "./apps/photoshop"; // importing a module registers its tools
import "./cad/tools";
import { hasWebGPU, Model, modelChoices } from "./llm/engine";
import { escapeHtml, Ledger } from "./toolkit/ledger";
import { runAgent, type Run, type Trace } from "./toolkit/loop";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const [modelSelect, loadBtn, rulesBox, status, progress] = [$<HTMLSelectElement>("model"), $<HTMLButtonElement>("load"), $<HTMLInputElement>("rules"), $("model-status"), $<HTMLProgressElement>("progress")];
const [requestInput, runBtn, fileInput, attached] = [$<HTMLInputElement>("request"), $<HTMLButtonElement>("run"), $<HTMLInputElement>("files"), $("attached")];
const [traceList, resultBox, ledgerTable, examples] = [$("trace"), $("result"), $<HTMLTableElement>("ledger"), $("examples")];

const EXAMPLES: Array<[label: string, request: string]> = [
  ["Eid Sale poster (PSD)", "photoshop file 1080x1080: background shop.jpg; logo logo.png top-left; title 'Eid Sale' white; subtitle '20% off' yellow"],
  ["10 marla house", "a 10 marla house with 3 bedrooms"],
  ["5 marla, 2 bedrooms", "floor plan for a 5 marla plot with 2 bedrooms"],
  ["Refusal: scale 1:100", "a 10 marla house with 3 bedrooms at scale 1:100"],
  ["Refusal: too many bedrooms", "a 5 marla house with 3 bedrooms"],
];

const ledger = new Ledger();
ledger.add({ task: "CapCut filter, screen agent", model: 13, tools: 0, ui: 32, tokens: "30k-42k", seconds: "155 s", checks: "failed", note: "reported in the article, not measured here" });
ledger.render(ledgerTable);

let model: Model | undefined;
const files = new Map<string, Blob>();

// model picker
const choices = modelChoices();
modelSelect.innerHTML = choices.ids.map((id) => `<option${id === choices.preferred ? " selected" : ""}>${id}</option>`).join("");
if (!hasWebGPU()) {
  loadBtn.disabled = true;
  status.textContent = 'This browser has no WebGPU, so no model can load. With "Rules first" on, the example requests still run.';
}

loadBtn.onclick = async () => {
  loadBtn.disabled = true;
  progress.hidden = false;
  try {
    model = await Model.load(modelSelect.value, (text, fraction) => {
      status.textContent = text;
      progress.value = fraction;
    });
    status.textContent = `${model.id} is loaded and runs on this device. Untick "Rules first" to make it fill every argument.`;
  } catch (e) {
    status.textContent = `Could not load the model: ${e instanceof Error ? e.message : e}`;
  }
  progress.hidden = true;
  loadBtn.disabled = false;
};

fileInput.onchange = () => {
  for (const f of fileInput.files ?? []) files.set(f.name, f);
  attached.textContent = files.size ? `Attached: ${[...files.keys()].join(", ")}` : "";
};

for (const [label, request] of EXAMPLES) {
  const b = document.createElement("button");
  b.textContent = label;
  b.title = request;
  b.onclick = () => {
    requestInput.value = request;
    void go();
  };
  examples.append(b);
}

function showTrace(t: Trace): void {
  const li = document.createElement("li");
  li.innerHTML = `<span class="k">${t.kind}</span><span class="s">${t.seconds === undefined ? "" : t.seconds.toFixed(t.seconds < 1 ? 3 : 1) + " s"}</span><span class="t">${escapeHtml(t.text)}</span>`;
  traceList.append(li);
}

function showResult(run: Run): void {
  const r = run.result;
  if (!r) {
    resultBox.innerHTML = `<p>${escapeHtml(run.reply)}</p>`;
    return;
  }
  if (r.refused) {
    resultBox.innerHTML = `<p class="refused"><b>Refused.</b> ${escapeHtml(r.refused)}</p><p class="status">A refusal is a result: the tool says why, in words the model can pass on or act on.</p>`;
    return;
  }
  const preview = r.preview ? r.files[r.preview] : undefined;
  resultBox.innerHTML =
    (preview ? `<img src="${preview.url}" alt="Preview of ${escapeHtml(preview.name)}" />` : "") +
    `<div class="files">${Object.values(r.files).map((f) => `<a href="${f.url}" download="${escapeHtml(f.name)}">${escapeHtml(f.name)}</a>`).join("")}</div>` +
    `<ul class="checks">${r.checks.map(([name, ok]) => `<li class="${ok ? "pass" : "fail"}"><b>${ok ? "pass" : "FAIL"}</b>${escapeHtml(name)}</li>`).join("")}</ul>` +
    (r.notes?.length ? `<ul class="notes">${r.notes.map((n) => `<li>${escapeHtml(n)}</li>`).join("")}</ul>` : "");
}

async function go(): Promise<void> {
  const request = requestInput.value.trim();
  if (!request || runBtn.disabled) return;
  runBtn.disabled = true;
  traceList.innerHTML = "";
  resultBox.innerHTML = '<p class="status">Working…</p>';
  try {
    const run = await runAgent(request, files, { model, rulesFirst: rulesBox.checked }, showTrace);
    showResult(run);
    const r = run.result;
    ledger.add({
      task: (run.toolName ?? "no tool") + ": " + (request.length > 48 ? request.slice(0, 48) + "…" : request),
      model: run.modelCalls,
      tools: run.toolCalls,
      ui: 0,
      tokens: run.inputTokens,
      seconds: run.seconds.toFixed(run.seconds < 1 ? 2 : 1) + " s",
      checks: !r ? "none" : r.refused ? "refused" : `${r.checks.filter(([, p]) => p).length}/${r.checks.length}`,
    });
    ledger.render(ledgerTable);
  } catch (e) {
    resultBox.innerHTML = `<p class="refused">${escapeHtml(e instanceof Error ? e.message : String(e))}</p>`;
  }
  runBtn.disabled = false;
}

runBtn.onclick = () => void go();
requestInput.onkeydown = (e) => {
  if (e.key === "Enter") void go();
};

// a shareable link: ?q=<request> runs it on load
const linked = new URLSearchParams(location.search).get("q");
if (linked) {
  requestInput.value = linked;
  void go();
}

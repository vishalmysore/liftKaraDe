// One row per task, so runs can be compared fairly.
export interface Row {
  task: string;
  model: number | string; // model calls
  tools: number; // tool calls
  ui: number; // actions on a visible window
  tokens: number | string; // input tokens
  seconds: string;
  checks: string;
  note?: string;
}

export class Ledger {
  rows: Row[] = [];

  add(row: Row): void {
    this.rows.push(row);
  }

  render(table: HTMLTableElement): void {
    const head = ["task", "model", "tools", "UI", "tokens", "seconds", "checks"];
    const cell = (v: unknown) => `<td>${String(v)}</td>`;
    table.innerHTML =
      `<thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>` +
      this.rows
        .map(
          (r) =>
            `<tr class="${r.note ? "quoted" : ""}"><td>${escapeHtml(r.task)}${r.note ? `<small>${escapeHtml(r.note)}</small>` : ""}</td>` +
            [r.model, r.tools, r.ui, typeof r.tokens === "number" ? r.tokens.toLocaleString() : r.tokens, r.seconds, r.checks]
              .map(cell)
              .join("") +
            "</tr>",
        )
        .join("") +
      "</tbody>";
  }
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

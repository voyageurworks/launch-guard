import type { Finding, Severity } from "./types.js";

const ORDER: Severity[] = ["block", "warn", "info"];

/** The lowest level that fails the run: `block` (default) or `warn`. */
export type FailOn = "block" | "warn";

export function exitCode(findings: Finding[], failOn: FailOn = "block"): 0 | 1 {
  return findings.some((f) => f.severity === "block" || (failOn === "warn" && f.severity === "warn")) ? 1 : 0;
}

// Built only from the five Finding fields, picked by name, so extra properties never reach the output.
function renderLine(f: Finding): string {
  const where = f.line === null ? f.file : `${f.file}:${f.line}`;
  const entry = f.entry === null ? "" : ` (list entry ${f.entry})`;
  return `  ${where} ${f.label}${entry}`;
}

/**
 * The same findings as `renderReport`, for other tools. Only the six fixed fields are copied, picked by name, so
 * extra properties never reach the output. Ordered like the text report (block, warn, info), scan order within a level.
 */
export function renderJson(findings: Finding[], failOn: FailOn = "block"): string {
  const counts = { block: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const picked = ORDER.flatMap((severity) => findings.filter((f) => f.severity === severity)).map((f) => ({
    category: f.category,
    severity: f.severity,
    file: f.file,
    line: f.line,
    label: f.label,
    entry: f.entry,
  }));
  const report = { version: 1, result: exitCode(findings, failOn) === 1 ? "fail" : "pass", counts, findings: picked };
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function renderReport(findings: Finding[]): string {
  if (findings.length === 0) return "No findings.\n";
  const out: string[] = [];
  for (const severity of ORDER) {
    const group = findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    out.push(`${severity.toUpperCase()} (${group.length})`, ...group.map(renderLine), "");
  }
  return out.join("\n");
}

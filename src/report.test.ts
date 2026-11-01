import { describe, expect, it } from "vitest";
import { exitCode, renderReport } from "./report.js";
import type { Finding } from "./types.js";

const make = (over: Partial<Finding>): Finding => ({
  category: "secret",
  severity: "block",
  file: "src/a.ts",
  line: 3,
  label: "secret format",
  entry: null,
  ...over,
});

describe("exitCode", () => {
  it("fails only when a block finding exists", () => {
    expect(exitCode([])).toBe(0);
    expect(exitCode([make({ severity: "warn" }), make({ severity: "info" })])).toBe(0);
    expect(exitCode([make({ severity: "warn" }), make({ severity: "block" })])).toBe(1);
  });
});

describe("renderReport", () => {
  it("lists file, line and label grouped by severity", () => {
    const out = renderReport([
      make({ severity: "warn", file: "b.md", line: 9, label: "personal detail", category: "personal" }),
      make({ severity: "block", file: "a.ts", line: 3 }),
      make({ severity: "info", file: "c.txt", line: null, label: "path matches list", category: "restricted", entry: 4 }),
    ]);
    expect(out).toContain("a.ts:3 secret format");
    expect(out).toContain("b.md:9 personal detail");
    expect(out).toContain("c.txt path matches list (list entry 4)");
    expect(out.indexOf("BLOCK")).toBeLessThan(out.indexOf("WARN"));
    expect(out.indexOf("WARN")).toBeLessThan(out.indexOf("INFO"));
  });

  it("reports a clean scan", () => {
    expect(renderReport([])).toContain("No findings");
  });

  it("never contains a sentinel placed in a Finding's unknown extra property", () => {
    const leaky = { ...make({}), matched: "SENTINEL-123" } as unknown as Finding;
    expect(renderReport([leaky])).not.toContain("SENTINEL-123");
  });
});

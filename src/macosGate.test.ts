import { describe, expect, it } from "vitest";
// @ts-expect-error: a plain ES module in scripts/, used by the workflow; tests are not type-checked in the build.
import { decide, parseJobs } from "../scripts/macos-gate.mjs";

const job = (name: string, conclusion: string | null) => ({ name, conclusion });

describe("macOS result gate: decide", () => {
  it("passes quietly when every macOS job passed", () => {
    const r = decide([job("macOS x64 (Node 22)", "success"), job("macOS arm64 (Node 22)", "success"), job("macOS result", null)]);
    expect(r.code).toBe(0);
    expect(r.level).toBe("none");
    expect(r.summary).toContain("macOS x64 (Node 22)");
  });

  it("fails when a macOS job ran and failed, even if others passed or were not run", () => {
    const r = decide([job("macOS x64 (Node 22)", "failure"), job("macOS arm64 (Node 22)", "success"), job("macOS latest (macos-26, arm64, Node 24)", "cancelled")]);
    expect(r.code).toBe(1);
    expect(r.level).toBe("error");
    expect(r.title).toMatch(/failed/i);
    expect(r.summary).toContain("macOS x64 (Node 22)");
  });

  it("passes with a loud warning when nothing ran (every job cancelled: no runner)", () => {
    const r = decide([job("macOS x64 (Node 22)", "cancelled"), job("macOS arm64 (Node 22)", "cancelled"), job("macOS result", null)]);
    expect(r.code).toBe(0);
    expect(r.level).toBe("warning");
    expect(r.title).toMatch(/NOT (run|verified)/);
    expect(r.summary).toMatch(/not verified on macOS/i);
  });

  it("treats skipped and unfinished jobs as not run when nothing passed", () => {
    expect(decide([job("macOS x64 (Node 22)", "skipped")]).level).toBe("warning");
    expect(decide([job("macOS x64 (Node 22)", null)]).level).toBe("warning");
  });

  it("does not raise a notice for a job that is skipped on purpose (a conditional job) when everything that ran passed", () => {
    const r = decide([job("macOS x64 (Node 22)", "success"), job("macOS x64 (Node 24)", "skipped")]);
    expect(r.code).toBe(0);
    expect(r.level).toBe("none");
    expect(r.title).toBe("macOS passed");
    expect(r.summary).toMatch(/skipped on purpose/i);
    expect(r.summary).toContain("macOS x64 (Node 24)");
  });

  it("still fails on a real failure next to a skipped job, and still notices a cancelled job next to a skipped one", () => {
    expect(decide([job("a", "failure"), job("b", "skipped")]).code).toBe(1);
    expect(decide([job("a", "success"), job("b", "cancelled"), job("c", "skipped")]).level).toBe("notice");
  });

  it("passes with a notice and names what was not run when some ran and passed and others were cancelled", () => {
    const r = decide([job("macOS x64 (Node 22)", "success"), job("macOS arm64 (Node 22)", "cancelled")]);
    expect(r.code).toBe(0);
    expect(r.level).toBe("notice");
    expect(r.summary).toContain("macOS arm64 (Node 22)");
    expect(r.summary).toMatch(/not run/i);
  });

  it("warns when there are no macOS jobs at all, instead of passing silently", () => {
    const r = decide([job("macOS result", null)]);
    expect(r.code).toBe(0);
    expect(r.level).toBe("warning");
  });

  it("never counts its own job", () => {
    expect(decide([job("macOS result", "failure"), job("macOS x64 (Node 22)", "success")]).code).toBe(0);
  });
});

describe("macOS result gate: parseJobs", () => {
  it("reads one JSON job per line and skips blank lines", () => {
    const text = `${JSON.stringify(job("a", "success"))}\n\n${JSON.stringify(job("b", "failure"))}\n`;
    expect(parseJobs(text).map((j: { name: string }) => j.name)).toEqual(["a", "b"]);
  });

  it("also reads a single JSON document with a jobs array", () => {
    expect(parseJobs(JSON.stringify({ jobs: [job("a", "success")] })).length).toBe(1);
  });
});

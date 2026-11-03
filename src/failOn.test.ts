import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import type { Scanners } from "./cli.js";
import { exitCode, renderJson } from "./report.js";
import { makeDir } from "./testRepos.js";
import type { Finding, Severity } from "./types.js";

function finding(severity: Severity): Finding {
  return { category: "basics", severity, file: "f", line: null, label: "missing CI", entry: null };
}

describe("exitCode with a fail-on level", () => {
  it("defaults to failing only on block", () => {
    expect(exitCode([finding("warn"), finding("info")])).toBe(0);
    expect(exitCode([finding("block")])).toBe(1);
  });

  it("fails on warn when asked", () => {
    expect(exitCode([finding("warn")], "warn")).toBe(1);
    expect(exitCode([finding("info")], "warn")).toBe(0);
    expect(exitCode([], "warn")).toBe(0);
  });

  it("renderJson result follows the level", () => {
    expect(JSON.parse(renderJson([finding("warn")])).result).toBe("pass");
    expect(JSON.parse(renderJson([finding("warn")], "warn")).result).toBe("fail");
  });
});

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) }, out, err };
}

/** Scanners that find one warning and nothing else. */
const warnOnly: Scanners = {
  listFiles: () => [],
  secrets: () => [finding("warn")],
  terms: () => [],
  history: () => [],
  reachability: () => [],
  basics: () => [],
  isRepoRoot: () => true,
};

const homes: Array<{ cleanup(): void }> = [];
afterEach(() => {
  vi.unstubAllEnvs();
  while (homes.length) homes.pop()!.cleanup();
});
function quietHome() {
  const h = makeDir("lg-home-");
  homes.push(h);
  vi.stubEnv("HOME", h.root);
  vi.stubEnv("USERPROFILE", h.root);
}

describe("--fail-on", () => {
  it("--fail-on warn turns a warning into exit 1 and RESULT: FAIL", async () => {
    quietHome();
    const dir = makeDir("lg-plain-");
    homes.push(dir);
    const plain = capture();
    expect(await main([dir.root], plain.io, warnOnly)).toBe(0);
    const strict = capture();
    expect(await main([dir.root, "--fail-on", "warn"], strict.io, warnOnly)).toBe(1);
    expect(strict.out.join("").trimEnd().endsWith("RESULT: FAIL")).toBe(true);
  });

  it("--fail-on block is the default spelled out", async () => {
    quietHome();
    const dir = makeDir("lg-plain-");
    homes.push(dir);
    const c = capture();
    expect(await main([dir.root, "--fail-on", "block"], c.io, warnOnly)).toBe(0);
  });

  it("--json reports the same result as the exit code", async () => {
    quietHome();
    const dir = makeDir("lg-plain-");
    homes.push(dir);
    const c = capture();
    expect(await main([dir.root, "--json", "--fail-on", "warn"], c.io, warnOnly)).toBe(1);
    expect(JSON.parse(c.out.join("")).result).toBe("fail");
  });

  it.each([
    [["--fail-on"]],
    [["--fail-on", "info"]],
    [["--fail-on", ""]],
    [["--fail-on", "warn", "--fail-on", "warn"]],
    [["--fail-on", "warn", "--init-list"]],
    [["--fail-on", "warn", "--print-hook"]],
  ])("rejects %j with exit 2 and the usage hint", async (argv) => {
    const c = capture();
    expect(await main(argv, c.io, warnOnly)).toBe(2);
    expect(c.err.join("")).toContain("Usage: launch-guard");
    expect(c.out).toEqual([]);
  });

  it("--help documents --fail-on", async () => {
    const c = capture();
    expect(await main(["--help"], c.io)).toBe(0);
    expect(c.out.join("")).toContain("--fail-on");
  });
});

import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import { renderJson } from "./report.js";
import type { Finding } from "./types.js";
import { makeBareRemote, makeDir, makeRepo } from "./testRepos.js";

const SLOW = 120_000;
// Fake key built by concatenation so this file holds nothing key-shaped.
const FAKE_AWS = "AKI" + "A" + "ZQSENTINEL7731" + "XY";
const BUNDLE = fileURLToPath(new URL("../skill/launch-guard.mjs", import.meta.url)).split("\\").join("/");

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) },
    out: () => out.join(""),
    err: () => err.join(""),
  };
}

function cleanFiles(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "README.md": "# demo\n",
    LICENSE: "MIT\n",
    "SECURITY.md": "report privately\n",
    ".github/workflows/ci.yml": "name: ci\n",
    ...extra,
  };
}

function fakeHome() {
  const home = makeDir("lg-home-");
  vi.stubEnv("HOME", home.root);
  vi.stubEnv("USERPROFILE", home.root);
  return home;
}

afterEach(() => vi.unstubAllEnvs());

describe("--json", () => {
  it("prints one JSON document with the six fixed fields and no secret, and exits 1 on a block", async () => {
    const home = fakeHome();
    const repo = makeRepo();
    try {
      repo.commit("init", cleanFiles({ "config.txt": `aws = ${FAKE_AWS}\n` }));
      const c = capture();
      expect(await main([repo.root, "--json", "--offline"], c.io)).toBe(1);
      const text = c.out();
      expect(text).not.toContain(FAKE_AWS);
      expect(text).not.toContain("RESULT:");
      const report = JSON.parse(text) as { version: number; result: string; counts: Record<string, number>; findings: Record<string, unknown>[] };
      expect(report.version).toBe(1);
      expect(report.result).toBe("fail");
      expect(report.counts.block).toBeGreaterThan(0);
      const hit = report.findings.find((f) => f.file === "config.txt");
      expect(hit).toEqual({ category: "secret", severity: "block", file: "config.txt", line: 1, label: "secret format", entry: null });
      for (const f of report.findings) expect(Object.keys(f).sort()).toEqual(["category", "entry", "file", "label", "line", "severity"]);
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("says pass and exits 0 for a clean repository", async () => {
    const home = fakeHome();
    const repo = makeRepo();
    try {
      repo.commit("init", cleanFiles());
      const c = capture();
      expect(await main([repo.root, "--json", "--offline"], c.io)).toBe(0);
      const report = JSON.parse(c.out()) as { result: string; counts: Record<string, number> };
      expect(report.result).toBe("pass");
      expect(report.counts.block).toBe(0);
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("keeps setup problems as plain text on stderr with exit 2, not JSON", async () => {
    const c = capture();
    expect(await main(["--json", "--json"], c.io)).toBe(2);
    expect(c.out()).toBe("");
    expect(c.err()).toContain("unrecognised or incomplete arguments");
    const d = capture();
    expect(await main(["--json", "--init-list"], d.io)).toBe(2);
    expect(d.out()).toBe("");
  });

  it("orders findings block, warn, info and copies only the fixed fields", () => {
    const base = { category: "basics", file: "f", line: null, entry: null } as const;
    const findings = [
      { ...base, severity: "info", label: "no remote", secret: "NOT-FOR-OUTPUT" },
      { ...base, severity: "block", label: "tracked env file" },
      { ...base, severity: "warn", label: "missing CI" },
    ] as unknown as Finding[];
    const text = renderJson(findings);
    expect(text).not.toContain("NOT-FOR-OUTPUT");
    const report = JSON.parse(text) as { findings: { severity: string }[]; counts: Record<string, number> };
    expect(report.findings.map((f) => f.severity)).toEqual(["block", "warn", "info"]);
    expect(report.counts).toEqual({ block: 1, warn: 1, info: 1 });
  });

  it("renders an empty report as pass with no findings", () => {
    expect(JSON.parse(renderJson([]))).toEqual({ version: 1, result: "pass", counts: { block: 0, warn: 0, info: 0 }, findings: [] });
  });
});

describe("--print-hook", () => {
  it("prints a shell script that stops the push on any non-zero result and writes nothing", async () => {
    const c = capture();
    expect(await main(["--print-hook"], c.io)).toBe(0);
    expect(c.err()).toBe("");
    const text = c.out();
    expect(text.startsWith("#!/bin/sh\n")).toBe(true);
    expect(text).toContain("--offline || exit 1");
    expect(text).toContain("/path/to/launch-guard.mjs");
  });

  it("cannot be combined with anything else", async () => {
    for (const extra of [["--offline"], ["--json"], ["."], ["--init-list"], ["--list", "x"], ["--print-hook"]]) {
      const c = capture();
      expect(await main(["--print-hook", ...extra], c.io)).toBe(2);
      expect(c.out()).toBe("");
    }
  });

  it("blocks a real git push of a leaking repository and lets a clean one through", async () => {
    const home = makeDir("lg-hookhome-");
    const remote = makeBareRemote();
    const leaky = makeRepo();
    const clean = makeRepo();
    try {
      const c = capture();
      await main(["--print-hook"], c.io);
      const script = c.out().replace("/path/to/launch-guard.mjs", BUNDLE);
      const env = { ...process.env, HOME: home.root, USERPROFILE: home.root, GIT_TERMINAL_PROMPT: "0" };
      const push = (repo: { root: string; git(...a: string[]): string }): number => {
        writeFileSync(join(repo.root, ".git", "hooks", "pre-push"), script);
        chmodSync(join(repo.root, ".git", "hooks", "pre-push"), 0o755);
        repo.git("remote", "add", "origin", remote.root);
        try {
          execFileSync("git", ["push", "origin", "HEAD:refs/heads/main"], { cwd: repo.root, env, stdio: "ignore", timeout: 90_000 });
          return 0;
        } catch (err) {
          return (err as { status?: number }).status ?? -1;
        }
      };
      leaky.commit("init", cleanFiles({ "config.txt": `aws = ${FAKE_AWS}\n` }));
      expect(push(leaky)).not.toBe(0);
      expect(remote.git("for-each-ref", "refs/heads/main").trim()).toBe("");
      clean.commit("init", cleanFiles());
      expect(push(clean)).toBe(0);
      expect(remote.git("for-each-ref", "refs/heads/main").trim()).not.toBe("");
    } finally {
      home.cleanup();
      remote.cleanup();
      leaky.cleanup();
      clean.cleanup();
    }
  }, SLOW);
});

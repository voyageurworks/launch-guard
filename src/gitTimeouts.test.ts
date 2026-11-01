import * as cp from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import { listRepoFiles } from "./files.js";
import { makeDir, makeRepo } from "./testRepos.js";
import { scanHistory } from "./scan/history.js";
import { checkReachability } from "./scan/reachability.js";

// Every production git call must carry a timeout, and a timed-out call must end in the tool's visible fallback.
// execFileSync is wrapped so each test can make chosen git calls fail like a hung child killed by the timeout.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, execFileSync: vi.fn(actual.execFileSync) };
});

const SLOW = 120_000;
const SENTINEL = "zq-sentinel-timeout-7731";
const exec = vi.mocked(cp.execFileSync);
const real = (await vi.importActual<typeof import("node:child_process")>("node:child_process")).execFileSync;

type Call = { args: string[]; options: { timeout?: number } };
const calls = (): Call[] =>
  exec.mock.calls
    .filter((c) => c[0] === "git")
    .map((c) => ({ args: c[1] as string[], options: (c[2] ?? {}) as { timeout?: number } }));

/** Runs real git, except calls for which `hang(args)` is true: those throw the error a timed-out child produces. */
function hangWhen(hang: (args: string[]) => boolean): void {
  exec.mockImplementation(((file: string, args: string[], options: object) => {
    if (file === "git" && hang(args)) {
      throw Object.assign(new Error(`spawnSync git ETIMEDOUT ${SENTINEL}`), { code: "ETIMEDOUT", signal: "SIGTERM" });
    }
    return (real as (...a: unknown[]) => unknown)(file, args, options);
  }) as never);
}

function repoWithCommit() {
  const repo = makeRepo();
  repo.commit("one", { "a.txt": "x\n", "README.md": "# demo\n" });
  return repo;
}

afterEach(() => {
  exec.mockReset();
  exec.mockImplementation(real as never);
  vi.unstubAllEnvs();
});

describe("every git call is bounded", () => {
  it("passes a positive timeout on every call of a full local scan", async () => {
    const repo = repoWithCommit();
    const home = makeDir("lg-home-");
    vi.stubEnv("HOME", home.root);
    vi.stubEnv("USERPROFILE", home.root);
    try {
      exec.mockClear();
      await main([repo.root, "--offline"], { out: () => undefined, err: () => undefined });
      const git = calls();
      expect(git.length).toBeGreaterThan(5);
      for (const c of git) expect(c.options.timeout, c.args.join(" ")).toBeGreaterThan(0);
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);
});

describe("a timed-out git call fails visibly", () => {
  it("history: every call hanging gives the history incomplete note", () => {
    const repo = repoWithCommit();
    try {
      hangWhen(() => true);
      expect(scanHistory(repo.root, [])).toEqual([
        { category: "history", severity: "info", file: "history", line: null, label: "history incomplete", entry: null },
      ]);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("history: a hung patch read is noted, stops promptly and prints nothing from the error", () => {
    const repo = repoWithCommit();
    repo.commit("two", { "b.txt": "y\n" });
    try {
      hangWhen((a) => a.includes("log"));
      exec.mockClear();
      const found = scanHistory(repo.root, [], { batch: 1 });
      expect(found.some((f) => f.label === "history incomplete" && f.severity === "info")).toBe(true);
      expect(JSON.stringify(found)).not.toContain(SENTINEL);
      // The first hung batch ends the patch phase: no per-commit retries of a git that is not answering.
      expect(calls().filter((c) => c.args.includes("log") && c.args.includes("--no-walk"))).toHaveLength(1);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("reachability: a hung local git call gives an info note, never a pass without a word", () => {
    const repo = repoWithCommit();
    try {
      hangWhen((a) => a.includes("for-each-ref"));
      const found = checkReachability(repo.root, { offline: true });
      expect(found).toEqual([
        { category: "reachability", severity: "info", file: "reachability", line: null, label: "history incomplete", entry: null },
      ]);
      hangWhen((a) => a.includes("fsck"));
      const second = checkReachability(repo.root, { offline: true });
      expect(second.some((f) => f.severity === "info" && f.label === "history incomplete")).toBe(true);
      expect(JSON.stringify([found, second])).not.toContain(SENTINEL);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("reachability: a hung git remote says remote not checked, never no remote", () => {
    const repo = repoWithCommit();
    try {
      repo.git("branch", "side");
      hangWhen((a) => a.includes("remote") && !a.includes("ls-remote"));
      const found = checkReachability(repo.root);
      expect(found.some((f) => f.file === "remote" && f.severity === "info" && f.label === "remote not checked")).toBe(true);
      expect(found.some((f) => f.label === "no remote")).toBe(false);
      // Findings from the other calls still appear.
      expect(found.some((f) => f.label === "extra ref" && f.severity === "warn")).toBe(true);
      expect(JSON.stringify(found)).not.toContain(SENTINEL);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("reachability: a hung symbolic-ref gives history incomplete, not false extra-ref alarms", () => {
    const repo = repoWithCommit();
    try {
      repo.git("tag", "v1");
      hangWhen((a) => a.includes("symbolic-ref"));
      const found = checkReachability(repo.root, { offline: true });
      expect(found.filter((f) => f.label === "history incomplete" && f.severity === "info")).toHaveLength(1);
      // The checked-out branch must not be reported as an extra ref; the tag still is (it does not depend on HEAD).
      expect(found.filter((f) => f.label === "extra ref")).toHaveLength(1);
      expect(found.some((f) => f.label === "no remote")).toBe(true);
      expect(JSON.stringify(found)).not.toContain(SENTINEL);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("reachability: a genuine detached HEAD still flags the branch as an extra ref", () => {
    const repo = repoWithCommit();
    try {
      repo.git("checkout", "-q", "--detach");
      const found = checkReachability(repo.root, { offline: true });
      expect(found.filter((f) => f.label === "extra ref")).toHaveLength(1);
      expect(found.some((f) => f.label === "history incomplete")).toBe(false);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("files: a hung ls-files falls back to the plain walk", () => {
    const repo = repoWithCommit();
    try {
      hangWhen((a) => a.includes("ls-files"));
      const files = listRepoFiles(repo.root).map((f) => f.path).sort();
      expect(files).toEqual(["README.md", "a.txt"]);
      expect(JSON.stringify(files)).not.toContain(SENTINEL);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("repo-root check: a hung rev-parse gives the not-a-repository-root warning", async () => {
    const repo = repoWithCommit();
    const home = makeDir("lg-home-");
    vi.stubEnv("HOME", home.root);
    vi.stubEnv("USERPROFILE", home.root);
    try {
      hangWhen((a) => a.includes("--show-toplevel"));
      const out: string[] = [];
      const err: string[] = [];
      const code = await main([repo.root, "--offline"], { out: (s) => void out.push(s), err: (s) => void err.push(s) });
      const text = out.join("") + err.join("");
      expect(code).not.toBe(2);
      expect(text).toContain("not a repository root");
      expect(text).not.toContain(SENTINEL);
      expect(text).not.toContain(repo.root);
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);
});

import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { main } from "../cli.js";
import { makeDir, makeRepo } from "../testRepos.js";
import { scanBasics } from "./basics.js";
import { scanHistory } from "./history.js";

const SLOW = 120_000;
// Built from pieces so this file holds nothing key-shaped.
const FAKE_AWS = "AKI" + "A" + "ZQSENTINEL7731" + "XY";

describe("history of merge commits and tags", () => {
  it("finds a secret that exists only in a conflict resolution", () => {
    const repo = makeRepo();
    try {
      repo.commit("base", { "f.txt": "a\n" });
      repo.git("checkout", "-q", "-b", "side");
      repo.commit("side", { "f.txt": "side\n" });
      repo.git("checkout", "-q", "-");
      repo.commit("main", { "f.txt": "main\n" });
      try {
        repo.git("merge", "--no-commit", "--no-ff", "side");
      } catch {
        // the conflict is the point
      }
      repo.write("f.txt", `resolved\naws = ${FAKE_AWS}\n`);
      repo.git("add", "f.txt");
      repo.git("commit", "-q", "-m", "merge side");
      const merge = repo.git("rev-parse", "--short", "HEAD").trim();
      const hits = scanHistory(repo.root, []).filter((f) => f.label === "secret in history");
      expect(hits).toEqual([{ category: "history", severity: "block", file: `${merge}:f.txt`, line: 2, label: "secret in history", entry: null }]);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("does not repeat a secret in a merge that an earlier commit already holds", () => {
    const repo = makeRepo();
    try {
      repo.commit("base", { "f.txt": "a\n" });
      repo.git("checkout", "-q", "-b", "side");
      repo.commit("side", { "g.txt": `aws = ${FAKE_AWS}\n` });
      repo.git("checkout", "-q", "-");
      repo.commit("main", { "h.txt": "h\n" });
      repo.git("merge", "-q", "--no-ff", "-m", "merge side", "side");
      const hits = scanHistory(repo.root, []).filter((f) => f.label === "secret in history");
      expect(hits).toHaveLength(1);
      expect(hits[0].file.endsWith(":g.txt")).toBe(true);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("finds a secret in an annotated tag message and prints only the tag's number", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x\n" });
      repo.git("tag", "-a", "v1", "-m", `release notes aws = ${FAKE_AWS}`);
      const found = scanHistory(repo.root, []);
      expect(found).toEqual([{ category: "history", severity: "block", file: "tag #1", line: null, label: "secret in history", entry: null }]);
      expect(JSON.stringify(found)).not.toContain("v1");
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("leaves a lightweight tag alone", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x\n" });
      repo.git("tag", "light");
      expect(scanHistory(repo.root, [])).toEqual([]);
    } finally {
      repo.cleanup();
    }
  }, SLOW);
});

describe("the user's own git config cannot change what the history scan reads", () => {
  it("log.showRoot=false does not hide a secret that only the root commit held", () => {
    const repo = makeRepo();
    try {
      repo.git("config", "log.showRoot", "false");
      repo.commit("first", { "a.txt": `aws = ${FAKE_AWS}\n` });
      repo.git("rm", "-q", "a.txt");
      repo.commit("remove");
      const hits = scanHistory(repo.root, []).filter((f) => f.label === "secret in history");
      expect(hits).toHaveLength(1);
      expect(hits[0].file.endsWith(":a.txt")).toBe(true);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("diff.suppressBlankEmpty=true does not move a finding to the wrong file or line", () => {
    const repo = makeRepo();
    try {
      repo.git("config", "diff.suppressBlankEmpty", "true");
      repo.commit("one", { "a.txt": "one\n\ntwo\n", "b.txt": "x\n" });
      repo.commit("two", { "a.txt": `one\n\ntwo\naws = ${FAKE_AWS}\n` });
      const sha = repo.git("rev-parse", "--short", "HEAD").trim();
      const hits = scanHistory(repo.root, []).filter((f) => f.label === "secret in history");
      expect(hits).toEqual([{ category: "history", severity: "block", file: `${sha}:a.txt`, line: 4, label: "secret in history", entry: null }]);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("diff.context=0 does not hide a split secret whose key line is unchanged", () => {
    const repo = makeRepo();
    try {
      repo.git("config", "diff.context", "0");
      repo.commit("one", { "c.yml": "password:\n  >-\n" });
      repo.commit("two", { "c.yml": "password:\n  >-\n  Zq8Lm2Xv9Kp4Rt7Wn5Hb3\n" });
      const hits = scanHistory(repo.root, []).filter((f) => f.label === "secret in history");
      expect(hits).toHaveLength(1);
    } finally {
      repo.cleanup();
    }
  }, SLOW);
});

describe("a scanned repository's own config cannot run a program", () => {
  it("core.fsmonitor in the repository is never executed by the scan", async () => {
    const dir = makeDir("lg-fsm-");
    const repo = makeRepo();
    const home = makeDir("lg-home-");
    try {
      const marker = join(dir.root, "ran.txt");
      dir.write("hook.mjs", `import { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(marker)}, "x");\nprocess.exit(1);\n`);
      repo.commit("one", { "a.txt": "x\n", LICENSE: "MIT\n", "SECURITY.md": "x\n", ".github/workflows/ci.yml": "name: ci\n" });
      repo.git("config", "core.fsmonitor", `node "${join(dir.root, "hook.mjs").split("\\").join("/")}"`);
      // Control: plain git does run it, so the assertion below is meaningful.
      repo.git("ls-files", "--others", "--exclude-standard");
      expect(existsSync(marker)).toBe(true);
      rmSync(marker);
      vi.stubEnv("HOME", home.root);
      vi.stubEnv("USERPROFILE", home.root);
      await main([repo.root, "--offline"], { out: () => undefined, err: () => undefined });
      expect(existsSync(marker)).toBe(false);
    } finally {
      vi.unstubAllEnvs();
      repo.cleanup();
      dir.cleanup();
      home.cleanup();
    }
  }, SLOW);
});

describe("submodules", () => {
  it("notes a submodule that is not scanned", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x\n" });
      const sha = repo.git("rev-parse", "HEAD").trim();
      repo.git("update-index", "--add", "--cacheinfo", `160000,${sha},vendor/lib`);
      const notes = scanBasics(repo.root).filter((f) => f.label === "submodule not scanned");
      expect(notes).toEqual([{ category: "basics", severity: "info", file: "submodules", line: null, label: "submodule not scanned", entry: null }]);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("says nothing when there are none", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "x\n" });
      expect(scanBasics(repo.root).some((f) => f.label === "submodule not scanned")).toBe(false);
    } finally {
      repo.cleanup();
    }
  }, SLOW);
});

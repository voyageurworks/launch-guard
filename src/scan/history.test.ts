import { describe, expect, it } from "vitest";
import { loadDenyList } from "../denylist.js";
import { makeDir, makeRepo, shallowClone } from "../testRepos.js";
import { scanHistory } from "./history.js";

const SLOW = 120_000;
// Fake keys are built by concatenation so this file holds nothing key-shaped.
const FAKE_AWS = "AKI" + "A" + "ZQSENTINEL7731" + "XY";

function entriesFor(text: string) {
  const d = makeDir("lg-list-");
  try {
    d.write("list.txt", text);
    return loadDenyList(`${d.root}/list.txt`).entries;
  } finally {
    d.cleanup();
  }
}

describe("scanHistory", () => {
  it("finds a secret that was committed then deleted", () => {
    const repo = makeRepo();
    try {
      repo.commit("add config", { "config.txt": `first\naws = ${FAKE_AWS}\n` });
      repo.git("rm", "-q", "config.txt");
      repo.commit("remove config");
      const sha = repo.git("rev-parse", "--short", "HEAD~1").trim();
      expect(scanHistory(repo.root, [])).toEqual([
        { category: "history", severity: "block", file: `${sha}:config.txt`, line: 2, label: "secret in history", entry: null },
      ]);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("downgrades a history finding in a test file by name, not in an ordinary file", () => {
    const header = "-----BEGIN " + "RSA PRIVATE KEY-----";
    const repo = makeRepo();
    try {
      repo.commit("add", { "x.test.ts": `a\n${header}\n`, "x.ts": `a\n${header}\n` });
      const sha = repo.git("rev-parse", "--short", "HEAD").trim();
      const findings = scanHistory(repo.root, []).filter((f) => f.label === "secret in history");
      expect(findings).toEqual(
        expect.arrayContaining([
          { category: "history", severity: "warn", file: `${sha}:x.test.ts`, line: 2, label: "secret in history", entry: null },
          { category: "history", severity: "block", file: `${sha}:x.ts`, line: 2, label: "secret in history", entry: null },
        ]),
      );
      expect(findings).toHaveLength(2);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("list matches in history stay block even in test files and test directories", () => {
    const repo = makeRepo();
    try {
      repo.commit("add", { "x.test.ts": "zq-hist-7731\n", "tests/zq-hist-7731.txt": "plain\n" });
      const sha = repo.git("rev-parse", "--short", "HEAD").trim();
      const entries = entriesFor("personal|zq-hist-7731\n");
      const findings = scanHistory(repo.root, entries);
      const term = findings.find((f) => f.label === "term in history" && f.file === `${sha}:x.test.ts`);
      const path = findings.find((f) => f.label === "path matches list");
      expect(term).toMatchObject({ severity: "block" });
      expect(path).toMatchObject({ severity: "block" });
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("finds a term only in an old commit message", () => {
    const repo = makeRepo();
    try {
      repo.commit("mention ZQ-SENTINEL-7731 here", { "a.txt": "clean\n" });
      repo.commit("tidy", { "a.txt": "still clean\n" });
      const sha = repo.git("rev-parse", "--short", "HEAD~1").trim();
      const findings = scanHistory(repo.root, entriesFor("# c\nrestricted|ZQ-SENTINEL-7731\n"));
      // The reflog subject repeats the message ("commit: ..."), so the reflog entries hit too.
      const [reflog, rest] = [findings.filter((f) => f.file.startsWith("reflog #")), findings.filter((f) => !f.file.startsWith("reflog #"))];
      expect(rest).toEqual([
        { category: "history", severity: "block", file: `${sha}:message`, line: null, label: "term in history", entry: 2 },
      ]);
      expect(reflog.length).toBeGreaterThan(0);
      expect(reflog.every((f) => f.entry === 2 && f.label === "term in history")).toBe(true);
      expect(JSON.stringify(findings)).not.toMatch(/sentinel/i);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("matches the author name, email and a branch name without printing any of them", () => {
    const repo = makeRepo();
    try {
      repo.commit("init", { "a.txt": "clean\n" }, { name: "Zq Person Name", email: "zqmail7731@example.invalid" });
      repo.git("branch", "zq-branch-7731");
      const sha = repo.git("rev-parse", "--short", "HEAD").trim();
      const findings = scanHistory(
        repo.root,
        entriesFor("personal|Zq Person Name\npersonal|zqmail7731@\nrestricted|zq-branch-7731\n"),
      );
      expect(findings.map((f) => [f.file, f.label, f.entry])).toEqual([
        [expect.stringMatching(/^ref #\d+$/), "term in history", 3],
        [`${sha}:author`, "term in history", 1],
        [`${sha}:author`, "term in history", 2],
      ]);
      expect(JSON.stringify(findings)).not.toMatch(/zq|person|name|mail|branch/i);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("repo with no commits reports info, not pass", () => {
    const repo = makeRepo();
    try {
      expect(scanHistory(repo.root, [])).toEqual([
        { category: "history", severity: "info", file: "history", line: null, label: "no commits", entry: null },
      ]);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("shallow clone reports info that history is incomplete", () => {
    const repo = makeRepo();
    let clone: { root: string; cleanup(): void } | undefined;
    try {
      repo.commit("one", { "a.txt": "clean\n" });
      repo.commit("two", { "a.txt": "still clean\n" });
      clone = shallowClone(repo);
      expect(scanHistory(clone.root, [])).toEqual([
        { category: "history", severity: "info", file: "history", line: null, label: "history incomplete", entry: null },
      ]);
    } finally {
      clone?.cleanup();
      repo.cleanup();
    }
  }, SLOW);

  it("a folder that is not a git repo reports info, never an error message", () => {
    const d = makeDir();
    try {
      expect(scanHistory(d.root, []).map((f) => [f.severity, f.label])).toEqual([["info", "history incomplete"]]);
    } finally {
      d.cleanup();
    }
  });

  it("control bytes in file text cannot truncate a record or leak into a finding", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": `x\u0001y\u0002ZQ-SENTINEL-7731\naws = ${FAKE_AWS}\n` });
      repo.commit("two", { "b.txt": `aws = ${FAKE_AWS}\n` });
      const findings = scanHistory(repo.root, entriesFor("restricted|ZQ-SENTINEL-7731\n"));
      expect(findings.filter((f) => f.label === "secret in history").map((f) => [f.file.split(":")[1], f.line])).toEqual(
        expect.arrayContaining([["a.txt", 2], ["b.txt", 1]]),
      );
      expect(findings.every((f) => /^([0-9a-f]{4,64}:|ref #|reflog #|history$)/.test(f.file))).toBe(true);
      expect(JSON.stringify(findings)).not.toMatch(/sentinel/i);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("keeps scanning later commits when a batch fails, and reports the one commit that cannot be read", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "a.txt": "clean\n" });
      repo.commit("two", { "big.txt": "y".repeat(79).concat("\n").repeat(4000) });
      repo.commit("three", { "c.txt": `aws = ${FAKE_AWS}\n` });
      const findings = scanHistory(repo.root, [], { maxBuffer: 100_000 });
      expect(findings.filter((f) => f.label === "history incomplete")).toHaveLength(1);
      expect(findings.filter((f) => f.label === "secret in history").map((f) => f.file.split(":")[1])).toEqual(["c.txt"]);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("matches file names with no diff header: empty file, binary file and pure rename", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "zq-empty-7731.txt": "", "a.txt": "one\ntwo\nthree\nfour\n" });
      repo.write("zq-bin-7731.dat", "a\u0000b");
      repo.commit("two");
      repo.git("mv", "a.txt", "zq-moved-7731.txt");
      repo.commit("three");
      repo.git("rm", "-q", "zq-empty-7731.txt");
      repo.commit("four");
      const findings = scanHistory(repo.root, entriesFor("restricted|zq-[a-z]+-7731\n"));
      const names = findings.filter((f) => f.label === "path matches list").map((f) => f.file.split(":")[1]);
      expect(names.sort()).toEqual(["[redacted].dat", "[redacted].txt", "[redacted].txt"]);
      expect(JSON.stringify(findings)).not.toMatch(/zq-/i);
    } finally {
      repo.cleanup();
    }
  }, SLOW);

  it("reports the full path even when diff.noprefix is set and a directory is called b", () => {
    const repo = makeRepo();
    try {
      repo.git("config", "diff.noprefix", "true");
      repo.commit("one", { "b/x.txt": `aws = ${FAKE_AWS}\n` });
      const sha = repo.git("rev-parse", "--short", "HEAD").trim();
      expect(scanHistory(repo.root, []).map((f) => f.file)).toEqual([`${sha}:b/x.txt`]);
    } finally {
      repo.cleanup();
    }
  }, SLOW);
});

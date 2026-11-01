import { homedir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import type { Scanners } from "./cli.js";
import { makeDir, makeRepo } from "./testRepos.js";

const SLOW = 120_000;
// Fake key built by concatenation so this file holds nothing key-shaped.
const FAKE_AWS = "AKI" + "A" + "ZQSENTINEL7731" + "XY";
const SENTINEL = "ZQ-SENTINEL-7731";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) },
    out,
    err,
    all: () => out.join("") + err.join(""),
  };
}

/** A repo with the files every basics check wants, so it is otherwise clean. */
function cleanRepo(extra: Record<string, string> = {}) {
  const repo = makeRepo();
  repo.commit("init", {
    "README.md": "# demo\n",
    LICENSE: "MIT\n",
    "SECURITY.md": "report privately\n",
    ".github/workflows/ci.yml": "name: ci\n",
    ...extra,
  });
  return repo;
}

/** Points HOME at an empty temp dir so the default private list is absent. */
function fakeHome() {
  const home = makeDir("lg-home-");
  vi.stubEnv("HOME", home.root);
  vi.stubEnv("USERPROFILE", home.root);
  return home;
}

afterEach(() => vi.unstubAllEnvs());

describe("main", () => {
  it("exit 1 when any block finding", async () => {
    const home = fakeHome();
    const repo = cleanRepo({ "config.txt": `aws = ${FAKE_AWS}\n` });
    try {
      const c = capture();
      expect(await main([repo.root], c.io)).toBe(1);
      expect(c.out.join("")).toContain("BLOCK");
      expect(c.out.join("").trimEnd().endsWith("RESULT: FAIL")).toBe(true);
      expect(c.all()).not.toContain(FAKE_AWS);
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("exit 0 and RESULT: PASS on a clean repo with a list", async () => {
    const repo = cleanRepo();
    const list = makeDir("lg-list-");
    try {
      list.write("list.txt", `restricted|${SENTINEL}\n`);
      const c = capture();
      expect(await main([repo.root, "--list", join(list.root, "list.txt")], c.io)).toBe(0);
      expect(c.out.join("").trimEnd().endsWith("RESULT: PASS")).toBe(true);
      expect(c.err).toEqual([]);
    } finally {
      repo.cleanup();
      list.cleanup();
    }
  }, SLOW);

  it("a repo with only dangling local objects still passes", async () => {
    const home = fakeHome();
    const repo = cleanRepo();
    try {
      repo.write("README.md", "second\n");
      repo.git("add", "README.md");
      repo.write("README.md", "third\n");
      repo.git("add", "README.md");
      repo.git("commit", "-q", "-m", "next");
      const c = capture();
      expect(await main([repo.root], c.io)).toBe(0);
      expect(c.out.join("")).toContain("unreachable object");
      expect(c.out.join("")).toContain("RESULT: PASS");
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);

  describe("repository root", () => {
    it("a plain directory warns once and skips history and reachability", async () => {
      const home = fakeHome();
      const dir = makeDir("lg-plain-");
      try {
        dir.write("a.txt", "hello\n");
        const c = capture();
        const code = await main([dir.root], c.io);
        const text = c.out.join("");
        expect(text.match(/not a repository root/g)?.length).toBe(1);
        expect(text).not.toContain("no commits");
        expect(text).not.toContain("history incomplete");
        expect(text).not.toContain("no remote");
        expect(code).toBe(0);
      } finally {
        dir.cleanup();
        home.cleanup();
      }
    }, SLOW);

    it("a subdirectory of another repository is not scanned through the parent's history", async () => {
      const home = fakeHome();
      const repo = cleanRepo({ "sub/ok.txt": "fine\n", "parent-only.txt": `aws = ${FAKE_AWS}\n` });
      try {
        repo.git("rm", "-q", "parent-only.txt");
        repo.commit("drop the key");
        const c = capture();
        const code = await main([join(repo.root, "sub")], c.io);
        const text = c.out.join("");
        expect(text.match(/not a repository root/g)?.length).toBe(1);
        expect(text).toContain("WARN");
        expect(text).not.toContain("secret in history");
        expect(text).not.toContain("no remote");
        expect(code).toBe(0);
        expect(c.all()).not.toContain(FAKE_AWS);
      } finally {
        repo.cleanup();
        home.cleanup();
      }
    }, SLOW);

    it("a repository root gets no such warning", async () => {
      const home = fakeHome();
      const repo = cleanRepo();
      try {
        const c = capture();
        await main([repo.root], c.io);
        expect(c.out.join("")).not.toContain("not a repository root");
      } finally {
        repo.cleanup();
        home.cleanup();
      }
    }, SLOW);
  });

  it("exit 2 with a fixed message for a bad path or bad list", async () => {
    const dir = makeDir("lg-bad-");
    try {
      dir.write("file.txt", "x");
      dir.write("bad-list.txt", `nonsense ${SENTINEL}\n`);
      const cases: string[][] = [
        [join(dir.root, "no-such-dir")],
        [join(dir.root, "file.txt")],
        [dir.root, "--list", join(dir.root, "no-such-list.txt")],
        [dir.root, "--list", join(dir.root, "bad-list.txt")],
      ];
      const seen = new Set<string>();
      for (const argv of cases) {
        const c = capture();
        expect(await main(argv, c.io)).toBe(2);
        expect(c.out).toEqual([]);
        expect(c.all()).not.toContain(SENTINEL);
        expect(c.all()).not.toContain(dir.root);
        expect(c.all()).not.toContain("no-such");
        seen.add(c.err.join(""));
      }
      expect(seen.size).toBe(2); // one fixed message per kind of problem
    } finally {
      dir.cleanup();
    }
  });

  it("runs with no list and reports that personal and restricted checks were skipped", async () => {
    const home = fakeHome();
    const repo = cleanRepo();
    try {
      const c = capture();
      expect(await main([repo.root], c.io)).toBe(0);
      expect(c.out.join("")).toContain("checks skipped: no private list");
      expect(c.out.join("")).toContain("RESULT: PASS");
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("a missing default list is not fatal but an invalid --list is", async () => {
    const home = fakeHome();
    const dir = makeDir("lg-plain-");
    try {
      dir.write("a.txt", "hello\n");
      const ok = capture();
      expect(await main([dir.root], ok.io)).not.toBe(2);
      const explicit = capture();
      expect(await main([dir.root, "--list", join(home.root, "missing.txt")], explicit.io)).toBe(2);
      // a default list that exists but is invalid is fatal too
      home.write(".config/launch-guard/private-list.txt", "garbage line\n");
      const bad = capture();
      expect(await main([dir.root], bad.io)).toBe(2);
      expect(bad.all()).not.toContain("garbage");
    } finally {
      dir.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("zero-entry list warns", async () => {
    const dir = makeDir("lg-plain-");
    try {
      dir.write("a.txt", "hello\n");
      dir.write("list/empty.txt", "# nothing here\n");
      const c = capture();
      await main([dir.root, "--list", join(dir.root, "list", "empty.txt")], c.io);
      expect(c.out.join("")).toContain("private list has no entries");
      expect(c.out.join("")).toContain("WARN");
    } finally {
      dir.cleanup();
    }
  }, SLOW);

  it("notes skipped files, capped, without leaking their content", async () => {
    const home = fakeHome();
    const dir = makeDir("lg-plain-");
    try {
      for (let i = 0; i < 27; i++) dir.write(`bin${i}.dat`, "a\u0000b" + SENTINEL);
      const c = capture();
      await main([dir.root], c.io);
      const text = c.out.join("");
      expect(text.match(/file skipped/g)?.length).toBe(25);
      expect(text).toContain("more files skipped");
      expect(text).not.toContain(SENTINEL);
    } finally {
      dir.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("--offline passes the flag to the reachability check and the default does not", async () => {
    const dir = makeDir("lg-plain-");
    try {
      dir.write("a.txt", "x\n");
      const seen: unknown[] = [];
      const spy: Scanners = {
        secrets: () => [],
        terms: () => [],
        history: () => [],
        reachability: (_root, offline) => (seen.push(offline), []),
        basics: () => [],
        listFiles: () => [],
      };
      await main([dir.root, "--offline"], capture().io, spy);
      await main([dir.root], capture().io, spy);
      expect(seen).toEqual([true, false]);
    } finally {
      dir.cleanup();
    }
  });

  it("--help mentions --offline and states the network and write behaviour", async () => {
    const c = capture();
    expect(await main(["--help"], c.io)).toBe(0);
    const text = c.out.join("");
    expect(text).toContain("--offline");
    expect(text).toContain("ls-remote");
    expect(text).not.toMatch(/never prints[^.]*location/i);
  });

  it("--help exits 0", async () => {
    const c = capture();
    expect(await main(["--help"], c.io)).toBe(0);
    expect(c.out.join("")).toContain("Usage: launch-guard");
    expect(c.err).toEqual([]);
  });

  it("unknown flag exits 2", async () => {
    for (const argv of [["--debug"], ["--list"], ["a", "b"], ["--list", "x", "--list", "y"], ["--zq-flag-7731"]]) {
      const c = capture();
      expect(await main(argv, c.io)).toBe(2);
      expect(c.err.join("")).toContain("Usage: launch-guard");
      expect(c.out).toEqual([]);
      // the offending argument text is never echoed back
      for (const a of argv) if (a.startsWith("--zq") || a === "--debug") expect(c.all()).not.toContain(a);
    }
  });

  it("a thrown scanner error is reduced to the fixed message", async () => {
    const dir = makeDir("lg-plain-");
    try {
      const boom: Scanners = {
        secrets: () => {
          throw new Error(`secret detail ${SENTINEL} at ${dir.root}`);
        },
        terms: () => [],
        history: () => [],
        reachability: () => [],
        basics: () => [],
        listFiles: () => [],
      };
      const c = capture();
      expect(await main([dir.root], c.io, boom)).toBe(2);
      expect(c.out).toEqual([]);
      expect(c.all()).not.toContain(SENTINEL);
      expect(c.all()).not.toContain("Error");
      expect(c.all()).not.toContain(dir.root);
      expect(c.err.join("")).toBe("launch-guard: the scan could not be completed.\n");
    } finally {
      dir.cleanup();
    }
  });

  it("output never contains the repo's absolute path or home directory", async () => {
    const realHome = homedir();
    const home = fakeHome();
    const repo = cleanRepo({
      "config.txt": `aws = ${FAKE_AWS}\n`,
      ".env": "TOKEN=x\n",
      "docs/notes.md": `see ${realHome.replace(/\\/g, "/")}/projects/x\n`,
    });
    try {
      const c = capture();
      await main([repo.root], c.io);
      const text = c.all().toLowerCase();
      const forms = (p: string) => [p, p.replace(/\\/g, "/"), JSON.stringify(p).slice(1, -1)];
      const base = repo.root.split(/[\\/]/).pop() as string;
      for (const p of [repo.root, realHome, home.root]) {
        for (const form of forms(p)) expect(text).not.toContain(form.toLowerCase());
      }
      expect(text).not.toContain(base.toLowerCase());
      expect(text).not.toContain(FAKE_AWS.toLowerCase());
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);
});

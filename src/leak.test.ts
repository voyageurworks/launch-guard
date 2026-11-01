import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import type { Io, Scanners } from "./cli.js";
import { makeDir, makeRepo } from "./testRepos.js";
import type { Identity } from "./testRepos.js";

const SLOW = 120_000;
const BUNDLE = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "skill", "launch-guard.mjs");

// Every private value below is an obviously fake sentinel.
const NAME = "zqname7731";
const STREET = "zqstreet7731";
const SCHOOL = "zqschool7731";
const EMAIL_USER = "zqmail7731";
const EMAIL = `${EMAIL_USER}@zqhost7731.invalid`;
const TERM = "zqrestricted7731";
const PROFILE = "zqprofile7731";
const BRANCH = "zqbranch7731";
const TAG = "zqtag7731";
// Fake key built by concatenation so this file holds nothing key-shaped.
const FAKE_KEY = "AKI" + "A" + "ZQSENTINEL7731" + "XY";

const SENTINELS = [NAME, STREET, SCHOOL, EMAIL_USER, EMAIL, TERM, PROFILE, BRANCH, TAG, FAKE_KEY];
const LIST_TEXT = [
  "# fake private list",
  `personal|${NAME}`,
  `personal|${STREET}`,
  `personal|${SCHOOL}`,
  `personal|${EMAIL_USER}@zqhost7731\\.invalid`,
  `restricted|${TERM}`,
  "",
].join("\n");

const AUTHOR: Identity = { name: `${NAME} Person`, email: EMAIL };

function windows(s: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i + n <= s.length; i++) out.push(s.slice(i, i + n));
  return out;
}

const pathForms = (p: string): string[] => [p, p.replace(/\\/g, "/"), JSON.stringify(p).slice(1, -1)];

/** Asserts that none of the sentinels, secret windows or private paths appears in `text`. */
function expectNoLeak(text: string, paths: string[]): void {
  const lower = text.toLowerCase();
  for (const s of SENTINELS) expect(lower, "a sentinel leaked").not.toContain(s.toLowerCase());
  for (const w of windows(FAKE_KEY, 4)) expect(lower, "part of the fake secret leaked").not.toContain(w.toLowerCase());
  for (const p of paths) {
    for (const form of pathForms(p)) {
      for (const v of [form, form.toLowerCase()]) expect(lower, "a private path leaked").not.toContain(v.toLowerCase());
    }
  }
}

interface Run {
  code: number;
  text: string;
  out: string;
}

/** Runs the real `main`, collecting everything it prints, the process streams and anything it throws. */
async function run(argv: string[], scanners?: Scanners, io?: Io): Promise<Run> {
  const chunks: string[] = [];
  const out: string[] = [];
  const spyOut = vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => (chunks.push(String(c)), true));
  const spyErr = vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => (chunks.push(String(c)), true));
  const spyLog = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => void chunks.push(a.join(" ")));
  const spyWarn = vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => void chunks.push(a.join(" ")));
  const spyError = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void chunks.push(a.join(" ")));
  let code = -1;
  try {
    code = await main(
      argv,
      io ?? {
        out: (s) => void (chunks.push(s), out.push(s)),
        err: (s) => void chunks.push(s),
      },
      scanners,
    );
  } catch (e) {
    chunks.push("THROWN:", String((e as Error)?.message), String((e as Error)?.stack));
    code = 99;
  } finally {
    for (const s of [spyOut, spyErr, spyLog, spyWarn, spyError]) s.mockRestore();
  }
  return { code, text: chunks.join(""), out: out.join("") };
}

function stubHome() {
  const home = makeDir("lg-home-");
  vi.stubEnv("HOME", home.root);
  vi.stubEnv("USERPROFILE", home.root);
  return home;
}

/** A repo with a sentinel in every place the tools look. */
function plantedRepo() {
  const repo = makeRepo();
  repo.commit(
    `add ${NAME} notes for ${SCHOOL}`,
    {
      "notes.txt": [
        `owner ${NAME}`,
        `lives on ${STREET}`,
        `studies at ${SCHOOL}`,
        `mail ${EMAIL}`,
        `codeword ${TERM}`,
        `aws_key = ${FAKE_KEY}`,
        "",
      ].join("\n"),
      [`${NAME}-file.txt`]: "plain\n",
      [`${SCHOOL}/inside.txt`]: "plain\n",
      "CLAUDE.md": `Notes for the assistant. Home is C:\\Users\\${PROFILE}\\work\n`,
    },
    AUTHOR,
  );
  repo.commit("add a file that will be deleted", { "old-secret.txt": `${TERM} ${FAKE_KEY}\n` }, AUTHOR);
  repo.git("rm", "-q", "old-secret.txt");
  repo.commit(`remove it (${TERM})`, {}, AUTHOR);
  repo.git("branch", BRANCH);
  repo.git("tag", TAG);
  return repo;
}

/** Name, size and mtime of every file under `dir`, skipping `.git`. */
function snapshot(dir: string, skipGit = false): string[] {
  const rows: string[] = [];
  const walk = (rel: string): void => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      if (skipGit && rel === "" && name === ".git") continue;
      const r = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, r));
      rows.push(`${r}|${st.isDirectory() ? "d" : st.size}|${st.mtimeMs}`);
      if (st.isDirectory()) walk(r);
    }
  };
  walk("");
  return rows;
}

afterEach(() => vi.unstubAllEnvs());

describe("leak sweep", () => {
  it("no planted sentinel appears in stdout, stderr, thrown errors or any file written", async () => {
    const home = stubHome();
    const lists = makeDir("lg-list-");
    const repo = plantedRepo();
    try {
      lists.write("private-list.txt", LIST_TEXT);
      const listFile = join(lists.root, "private-list.txt");
      const result = await run([repo.root, "--list", listFile]);
      expect(result.code).toBe(1);
      expectNoLeak(result.text, [repo.root, lists.root, listFile, home.root, homedir()]);

      // The scanners must not have gone quiet: one finding of every class.
      for (const wanted of [
        "secret format",
        "personal detail",
        "restricted term",
        "term in history",
        "user profile path",
        "path matches list",
        "missing LICENSE",
        "list entry",
      ]) {
        expect(result.out, `expected a finding: ${wanted}`).toContain(wanted);
      }
      expect(result.out).toMatch(/secret in history|term in history/);
      expect(result.out).toContain("[redacted]");
      expect(result.out.trimEnd().endsWith("RESULT: FAIL")).toBe(true);
    } finally {
      repo.cleanup();
      lists.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("the built script prints no sentinel on stdout or stderr either", async () => {
    expect(existsSync(BUNDLE)).toBe(true);
    const home = stubHome();
    const lists = makeDir("lg-list-");
    const repo = plantedRepo();
    try {
      lists.write("private-list.txt", LIST_TEXT);
      const listFile = join(lists.root, "private-list.txt");
      const r = spawnSync(process.execPath, [BUNDLE, repo.root, "--list", listFile], {
        encoding: "utf8",
        env: { ...process.env, HOME: home.root, USERPROFILE: home.root },
        timeout: SLOW,
      });
      expectCompleted(r);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("RESULT: FAIL");
      expectNoLeak(r.stdout + r.stderr, [repo.root, lists.root, listFile, home.root, homedir()]);
    } finally {
      repo.cleanup();
      lists.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("no file is created or changed in the temp or output folders during a run", async () => {
    const home = stubHome();
    const lists = makeDir("lg-list-");
    const tmp = makeDir("lg-tmp-");
    const repo = plantedRepo();
    try {
      lists.write("private-list.txt", LIST_TEXT);
      const listFile = join(lists.root, "private-list.txt");
      vi.stubEnv("TMPDIR", tmp.root);
      vi.stubEnv("TEMP", tmp.root);
      vi.stubEnv("TMP", tmp.root);
      const before = {
        tmp: snapshot(tmp.root),
        home: snapshot(home.root),
        lists: snapshot(lists.root),
        tree: snapshot(repo.root, true),
      };
      const result = await run([repo.root, "--list", listFile]);
      expect(result.code).toBe(1);
      expect(snapshot(tmp.root)).toEqual(before.tmp);
      expect(snapshot(home.root)).toEqual(before.home);
      expect(snapshot(lists.root)).toEqual(before.lists);
      expect(snapshot(repo.root, true)).toEqual(before.tree);
      expect(before.tmp).toEqual([]);
      expect(before.home).toEqual([]);
    } finally {
      repo.cleanup();
      lists.cleanup();
      tmp.cleanup();
      home.cleanup();
    }
  }, SLOW);
});

describe("leak sweep: list text inside directory names", () => {
  const DIR = "zqdirname7731";
  const forms = (s: string): string[] => [s, s.toUpperCase(), s.replace(/\\/g, "/"), JSON.stringify(s).slice(1, -1)];

  it("a directory name matching a list entry never prints in the secrets or basics findings", async () => {
    const home = stubHome();
    const lists = makeDir("lg-list-");
    const repo = makeRepo();
    try {
      lists.write("private-list.txt", `personal|${DIR}\n`);
      const listFile = join(lists.root, "private-list.txt");
      repo.commit("init", {
        [`${DIR}-smith/a.ts`]: `const k = "${FAKE_KEY}";\n`,
        [`${DIR}-smith/CLAUDE.md`]: `Home is C:\\Users\\${PROFILE}\\work\n`,
        LICENSE: "MIT\n",
      });
      const result = await run([repo.root, "--list", listFile]);
      expect(result.code).toBe(1);
      expect(result.out).toContain("secret format");
      expect(result.out).toContain("user profile path");
      expect(result.out).toContain("[redacted]");
      for (const form of forms(DIR)) expect(result.text.toLowerCase()).not.toContain(form.toLowerCase());
      expectNoLeak(result.text, [repo.root, lists.root, listFile, home.root, homedir()]);
    } finally {
      repo.cleanup();
      lists.cleanup();
      home.cleanup();
    }
  }, SLOW);
});

describe("leak sweep: error paths", () => {
  it("a malformed list entry exits 2 without echoing the entry", async () => {
    const home = stubHome();
    const lists = makeDir("lg-list-");
    const repo = plantedRepo();
    try {
      lists.write("bad.txt", `personal|${NAME}\nnonsense ${TERM} (${FAKE_KEY}\npersonal|(${STREET}\n`);
      const listFile = join(lists.root, "bad.txt");
      const result = await run([repo.root, "--list", listFile]);
      expect(result.code).toBe(2);
      expect(result.out).toBe("");
      expectNoLeak(result.text, [repo.root, lists.root, listFile, home.root, homedir()]);
    } finally {
      repo.cleanup();
      lists.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("an unreadable list exits 2 without naming it", async () => {
    const home = stubHome();
    const lists = makeDir("lg-list-");
    const repo = plantedRepo();
    try {
      mkdirSync(join(lists.root, `${NAME}-dir`)); // a directory where a file is expected
      const listFile = join(lists.root, `${NAME}-dir`);
      const result = await run([repo.root, "--list", listFile]);
      expect(result.code).toBe(2);
      expectNoLeak(result.text, [repo.root, lists.root, listFile, home.root, homedir()]);
    } finally {
      repo.cleanup();
      lists.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("an unreadable file does not leak and the run still fails on the other findings", async (ctx) => {
    const home = stubHome();
    const lists = makeDir("lg-list-");
    const repo = plantedRepo();
    const locked = join(repo.root, `${NAME}-locked.txt`);
    let restore: (() => void) | null = null;
    try {
      writeFileSync(locked, `${TERM} ${FAKE_KEY}\n`);
      restore = lockFile(locked);
      if (restore === null) ctx.skip(); // cannot make a file unreadable here (for example running as root)
      lists.write("private-list.txt", LIST_TEXT);
      const listFile = join(lists.root, "private-list.txt");
      const result = await run([repo.root, "--list", listFile]);
      expect(result.code).not.toBe(0);
      expect(result.code).not.toBe(99);
      expect(result.out).toContain("file skipped");
      expectNoLeak(result.text, [repo.root, lists.root, listFile, home.root, homedir()]);
    } finally {
      restore?.();
      repo.cleanup();
      lists.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("a corrupt git object exits non-zero, with nothing leaked on any stream", async () => {
    const home = stubHome();
    const lists = makeDir("lg-list-");
    const repo = plantedRepo();
    const copy = makeDir("lg-corrupt-");
    try {
      cpSync(repo.root, copy.root, { recursive: true });
      const objects = join(copy.root, ".git", "objects");
      let corrupted = 0;
      for (const d of readdirSync(objects)) {
        if (!/^[0-9a-f]{2}$/.test(d)) continue;
        for (const f of readdirSync(join(objects, d))) {
          const file = join(objects, d, f);
          chmodSync(file, 0o666);
          truncateSync(file, 6);
          corrupted++;
        }
      }
      expect(corrupted).toBeGreaterThan(0);
      lists.write("private-list.txt", LIST_TEXT);
      const listFile = join(lists.root, "private-list.txt");
      const paths = [copy.root, repo.root, lists.root, listFile, home.root, homedir()];

      const result = await run([copy.root, "--list", listFile]);
      expect(result.code).not.toBe(0);
      expect(result.code).not.toBe(99);
      expectNoLeak(result.text, paths);

      // Child processes write straight to the inherited streams, so also run the built script and read its real stderr.
      const r = spawnSync(process.execPath, [BUNDLE, copy.root, "--list", listFile], {
        encoding: "utf8",
        env: { ...process.env, HOME: home.root, USERPROFILE: home.root },
        timeout: SLOW,
      });
      expectCompleted(r);
      expect(r.status).toBeGreaterThan(0);
      expectNoLeak(r.stdout + r.stderr, paths);
      expect(r.stderr).not.toMatch(/fatal|error:|object file|corrupt/i);
    } finally {
      copy.cleanup();
      repo.cleanup();
      lists.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("a thrown scanner error with sentinels in its message prints only the fixed message", async () => {
    const home = stubHome();
    const dir = makeDir("lg-plain-");
    try {
      dir.write("a.txt", "x\n");
      const boom: Scanners = {
        secrets: () => {
          const e = new Error(`${FAKE_KEY} ${NAME} ${dir.root}`);
          e.stack = `stack ${TERM} ${dir.root}`;
          throw e;
        },
        terms: () => [],
        history: () => [],
        reachability: () => [],
        basics: () => [],
        listFiles: () => [],
      };
      const result = await run([dir.root], boom);
      expect(result.code).toBe(2);
      expect(result.text).toBe("launch-guard: the scan could not be completed.\n");
    } finally {
      dir.cleanup();
      home.cleanup();
    }
  });
});

describe("failing output streams", () => {
  const boomErr: Io = {
    out: () => undefined,
    err: () => {
      throw new Error(`EPIPE ${FAKE_KEY} ${NAME}`);
    },
  };

  it("exits 2, never 1 and never rejects, when writing the error message itself throws", async () => {
    const dir = makeDir("lg-plain-");
    try {
      dir.write("a.txt", "x\n");
      const scanners: Scanners = {
        secrets: () => {
          throw new Error(NAME);
        },
        terms: () => [],
        history: () => [],
        reachability: () => [],
        basics: () => [],
        listFiles: () => [],
      };
      for (const argv of [[dir.root], ["--no-such-flag"], [join(dir.root, "missing")]]) {
        const r = await run(argv, argv[0] === dir.root ? scanners : undefined, boomErr);
        expect(r.code).toBe(2);
        expect(r.text).not.toContain("THROWN");
        expectNoLeak(r.text, [dir.root]);
      }
    } finally {
      dir.cleanup();
    }
  });

  it("exits 2, not the block code, when writing the report throws", async () => {
    const home = stubHome();
    const repo = makeRepo();
    try {
      repo.commit("init", { "config.txt": `aws = ${FAKE_KEY}\n` });
      const failing: Io = {
        out: () => {
          throw new Error("EPIPE");
        },
        err: () => {
          throw new Error("EPIPE");
        },
      };
      const r = await run([repo.root], undefined, failing);
      expect(r.code).toBe(2);
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);
});

describe("argument errors", () => {
  it("never echo the offending flag text on stdout or stderr", async () => {
    const odd = "--zq-flag-7731";
    for (const argv of [[odd], [odd, "x"], ["--list", odd], ["--init-list", "a", odd], [`--list=${odd}`]]) {
      const r = await run(argv);
      expect(r.code).toBe(2);
      expect(r.text).not.toContain("zq-flag-7731");
      expect(r.text).not.toContain(odd);
    }
  });
});

/** Fails the test when a spawned child was killed by its timeout (or never started): null status must not read as a pass. */
function expectCompleted(r: { error?: Error; signal: NodeJS.Signals | null; status: number | null }): void {
  expect(r.error, "child process error (a timeout shows as ETIMEDOUT)").toBeUndefined();
  expect(r.signal, "child process was killed by a signal").toBeNull();
  expect(r.status, "child process exit status").not.toBeNull();
}

/** A hung probe must fail the test, never read as "cannot read" or "cannot lock". */
function rethrowTimeout(err: unknown): void {
  if ((err as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT") throw err;
}

/** True when this process can read `file` (probed in a child process, so nothing is cached). */
function canRead(file: string): boolean {
  try {
    execFileSync(process.execPath, ["-e", "require('fs').readFileSync(process.argv[1])", file], { stdio: "ignore", timeout: 30_000 });
    return true;
  } catch (err) {
    rethrowTimeout(err);
    return false;
  }
}

/** Makes `file` unreadable for this process; returns the undo function, or null when that is not possible here. */
function lockFile(file: string): (() => void) | null {
  if (process.platform === "win32") {
    const undo = (): void => {
      try {
        execFileSync("icacls", [file, "/remove:d", "*S-1-1-0"], { stdio: "ignore", timeout: 30_000 });
      } catch (err) {
        rethrowTimeout(err); // other failures: best effort
      }
    };
    try {
      execFileSync("icacls", [file, "/deny", "*S-1-1-0:(R,RD)"], { stdio: "ignore", timeout: 30_000 });
    } catch (err) {
      rethrowTimeout(err);
      return null;
    }
    if (canRead(file)) {
      undo();
      return null;
    }
    return undo;
  }
  if (typeof process.getuid === "function" && process.getuid() === 0) return null;
  chmodSync(file, 0o000);
  return canRead(file) ? (chmodSync(file, 0o600), null) : () => chmodSync(file, 0o600);
}

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { main } from "./cli.js";
import { makeDir, makeRepo } from "./testRepos.js";

const SLOW = 120_000;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKILL_DIR = join(ROOT, "skill");
const SKILL_MD = join(SKILL_DIR, "SKILL.md");
const BUNDLE = join(SKILL_DIR, "launch-guard.mjs");

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return {
    io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) },
    all: () => out.join("") + err.join(""),
  };
}

afterEach(() => vi.unstubAllEnvs());

describe("skill package", () => {
  it("SKILL.md has name and description frontmatter", () => {
    const text = readFileSync(SKILL_MD, "utf8");
    const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(text);
    expect(m).not.toBeNull();
    const front = m![1]!;
    expect(front).toMatch(/^name: launch-guard\s*$/m);
    const desc = /^description: (.+)$/m.exec(front);
    expect(desc).not.toBeNull();
    expect(desc![1]!).toMatch(/public/i);
    expect(desc![1]!.length).toBeGreaterThan(40);
  });

  describe("built script", () => {
    it("built script exists after build and runs with --help", () => {
      // Tests never build into shared output; a missing bundle means `pnpm build` has not been run.
      expect(existsSync(BUNDLE), "skill/launch-guard.mjs is missing: run `pnpm build`").toBe(true);
      const out = execFileSync(process.execPath, [BUNDLE, "--help"], { encoding: "utf8", timeout: SLOW });
      expect(out).toContain("Usage: launch-guard");
      expect(readFileSync(BUNDLE, "utf8").startsWith("#!/usr/bin/env node")).toBe(true);
    });
  });

  it("SKILL.md says it works for both Claude Code and Codex", () => {
    const text = readFileSync(SKILL_MD, "utf8");
    expect(text).toMatch(/Claude Code and Codex/);
    expect(text).toMatch(/skills directory/);
  });

  it("the docs state the real network and write behaviour, not absolute claims", () => {
    for (const file of ["README.md", "SECURITY.md", join("skill", "SKILL.md")]) {
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(text, file).toContain("ls-remote");
      expect(text, file).toContain("--offline");
      expect(text, file).toContain("--init-list");
      expect(text, file).not.toMatch(/uses the network|makes? network calls|It only reads/i);
    }
  });

  describe("committed bundle", () => {
    // Builds into a private temp folder (its own dist/), never into the project's dist/ or skill/, so a concurrent
    // test file or a second vitest process can never read a half-written build output.
    let work: ReturnType<typeof makeDir>;
    beforeAll(() => {
      work = makeDir("lg-bundle-");
      // No shell: Node does not quote arguments under shell:true (a temp path with a space would break), and a
      // timeout would kill only the shell. TypeScript is resolved from the project, not from a hard-coded path.
      const tsPkg = createRequire(join(ROOT, "package.json")).resolve("typescript/package.json");
      const tsc = join(dirname(tsPkg), (JSON.parse(readFileSync(tsPkg, "utf8")) as { bin: { tsc: string } }).bin.tsc);
      try {
        execFileSync(process.execPath, [tsc, "-p", ".", "--outDir", join(work.root, "dist")], {
          cwd: ROOT,
          timeout: SLOW,
          stdio: ["ignore", "pipe", "pipe"],
          encoding: "utf8",
        });
      } catch (err) {
        const e = err as { stdout?: string; stderr?: string; message: string };
        // tsc prints its diagnostics on stdout
        expect.fail(`tsc failed: ${(e.stdout || e.stderr || e.message).trim().slice(0, 2000)}`);
      }
    }, SLOW);
    afterAll(() => work?.cleanup());

    it("skill/launch-guard.mjs matches a fresh build byte for byte", async () => {
      const mod = await import(pathToFileURL(join(ROOT, "scripts", "build-skill.mjs")).href);
      const fresh = join(work.root, "fresh.mjs");
      await mod.bundle(fresh, work.root);
      const norm = (f: string) => readFileSync(f, "utf8").split("\r\n").join("\n");
      const a = norm(fresh);
      const b = norm(BUNDLE);
      if (a !== b) {
        let i = 0;
        while (i < a.length && a[i] === b[i]) i++;
        const line = a.slice(0, i).split("\n").length;
        expect.fail(
          `skill/launch-guard.mjs is stale: it differs from a fresh build (first difference at line ${line}; ` +
            `fresh ${a.length} chars, committed ${b.length} chars). Run \`pnpm build\` and commit skill/launch-guard.mjs.`,
        );
      }
      expect(a).toBe(b);
    }, SLOW);
  });

  it("SKILL.md contains the never-open-the-list and never-ask-for-values-in-chat rules", () => {
    const text = readFileSync(SKILL_MD, "utf8");
    expect(text).toContain("NEVER open, cat, grep, search or print the private list");
    expect(text).toContain("Never ask the user to type or paste");
    expect(text).toContain("into chat");
    expect(text).toContain("--init-list");
    expect(text).toContain("permission rule");
  });

  it("no example in SKILL.md, the README or --help holds a non-fake value", () => {
    const docs: string[] = [readFileSync(SKILL_MD, "utf8")];
    const readme = join(ROOT, "README.md");
    if (existsSync(readme)) docs.push(readFileSync(readme, "utf8"));
    const help = execFileSync(process.execPath, [BUNDLE, "--help"], { encoding: "utf8", timeout: SLOW });
    docs.push(help);
    for (const doc of docs) {
      expect(doc).not.toMatch(/[\w.+-]+@[\w-]+(\.[\w-]+)+/); // any email address
      expect(doc).not.toMatch(/@gmail\.com/i);
      for (const m of doc.matchAll(/C:\\Users\\([^\\\s"'`]+)/gi)) expect(m[1]).toMatch(/^<.+>$/);
      for (const m of doc.matchAll(/(?:\/home|\/Users)\/([^/\s"'`]+)/g)) expect(m[1]).toMatch(/^<.+>$/);
      // Template example lines: personal|... or restricted|... must use fake zq- words only.
      for (const m of doc.matchAll(/(?:personal|restricted)\|(\S+)/g)) {
        expect(m[1]).toMatch(/^(zq-[\w-]*|example\S*|<[^>]+>)$/);
      }
    }
  });
});

describe("--init-list", () => {
  function setup() {
    const home = makeDir("lg-home-");
    vi.stubEnv("HOME", home.root);
    vi.stubEnv("USERPROFILE", home.root);
    return home;
  }

  it("--init-list writes only placeholders", async () => {
    const home = setup();
    try {
      const target = join(home.root, ".config", "launch-guard", "private-list.txt");
      const c = capture();
      expect(await main(["--init-list"], c.io)).toBe(0);
      const lines = readFileSync(target, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
      expect(lines.length).toBeGreaterThan(2);
      for (const l of lines) expect(l.startsWith("#")).toBe(true);
      expect(lines.join("\n")).toContain("kind|regex");
      expect(lines.join("\n")).toContain("zq-example");
      const shown = c.all();
      expect(shown).toContain("~");
      expect(shown).toContain("private-list.txt");
      expect(shown).not.toContain(home.root);
      expect(shown).not.toContain(home.root.replace(/\\/g, "/"));
      expect(shown).toMatch(/own editor/);
      expect(shown).toMatch(/chat/);

      const again = capture();
      expect(await main(["--init-list"], again.io)).toBe(2);
      expect(again.all()).toContain("already exists");
      expect(again.all()).not.toContain(home.root);
    } finally {
      home.cleanup();
    }
  });

  it("--init-list takes an explicit file and creates parent directories", async () => {
    const home = setup();
    const dir = makeDir("lg-out-");
    try {
      const target = join(dir.root, "a", "b", "list.txt");
      const c = capture();
      expect(await main(["--init-list", target], c.io)).toBe(0);
      expect(existsSync(target)).toBe(true);
      expect(await main(["--init-list", target, "extra"], capture().io)).toBe(2);
      expect(await main(["--init-list", "--list", target], capture().io)).toBe(2);
    } finally {
      dir.cleanup();
      home.cleanup();
    }
  });

  it("--init-list refuses a target inside a git repository", async () => {
    const home = setup();
    const repo = makeRepo();
    try {
      mkdirSync(join(repo.root, "sub"), { recursive: true });
      const target = join(repo.root, "sub", "list.txt");
      const c = capture();
      expect(await main(["--init-list", target], c.io)).toBe(2);
      expect(existsSync(target)).toBe(false);
      expect(c.all()).toContain("git repository");
      expect(c.all()).not.toContain(repo.root);
    } finally {
      repo.cleanup();
      home.cleanup();
    }
  }, SLOW);
});

describe("--init-list path display", () => {
  const variants: [string, (home: string, rest: string) => string][] = [
    ["mixed-case path", (h, r) => join(h.toUpperCase(), r)],
    ["lower-case path", (h, r) => join(h.toLowerCase(), r)],
    ["forward-slash path", (h, r) => slashes(h) + "/" + slashes(r)],
  ];
  for (const [name, make] of variants) {
    it.skipIf(name.includes("case") && process.platform !== "win32")(`prints ~ for a ${name} under home`, async () => {
      const home = makeDir("lg-home-");
      vi.stubEnv("HOME", home.root);
      vi.stubEnv("USERPROFILE", home.root);
      try {
        const c = capture();
        expect(await main(["--init-list", make(home.root, "x/list.txt")], c.io)).toBe(0);
        expectNoHome(c.all(), home.root);
        expect(c.all()).toContain("~/x/list.txt");
      } finally {
        home.cleanup();
      }
    });
  }

  it("prints ~ when the home directory ends with a separator", async () => {
    const home = makeDir("lg-home-");
    vi.stubEnv("HOME", home.root + "/");
    vi.stubEnv("USERPROFILE", home.root + "\\");
    try {
      expect(homedir()).not.toBe("");
      const c = capture();
      expect(await main(["--init-list", join(home.root, "y", "list.txt")], c.io)).toBe(0);
      expectNoHome(c.all(), home.root);
      expect(c.all()).toContain("~/y/list.txt");
    } finally {
      home.cleanup();
    }
  });

  it("prints only the file name for a target outside home", async () => {
    const home = makeDir("lg-home-");
    const elsewhere = makeDir("lg-else-");
    vi.stubEnv("HOME", home.root);
    vi.stubEnv("USERPROFILE", home.root);
    try {
      const c = capture();
      expect(await main(["--init-list", join(elsewhere.root, "z", "list.txt")], c.io)).toBe(0);
      expectNoHome(c.all(), elsewhere.root);
      expect(c.all()).toContain("list.txt");
      expect(c.all()).not.toContain("/z/");
    } finally {
      home.cleanup();
      elsewhere.cleanup();
    }
  });
});

function slashes(s: string): string {
  return s.split("\\").join("/");
}

function expectNoHome(shown: string, home: string): void {
  const forms = [home, slashes(home), JSON.stringify(home).slice(1, -1)];
  for (const f of forms) expect(shown.toLowerCase()).not.toContain(f.toLowerCase());
}

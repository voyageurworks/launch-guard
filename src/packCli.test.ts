import { afterEach, describe, expect, it, vi } from "vitest";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { main } from "./cli.js";
import type { Scanners } from "./cli.js";
import { scanSecrets } from "./scan/secrets.js";
import { scanTerms } from "./scan/terms.js";
import { NPM_OK } from "./testNpm.js";
import { makeDir } from "./testRepos.js";
import { makeTgz } from "./testTar.js";
import type { TarEntry } from "./testTar.js";

const SLOW = 180_000;
// Fake key built by concatenation so this file holds nothing key-shaped.
const FAKE_AWS = "AKI" + "A" + "ZQSENTINEL7731" + "XY";

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

const homes: Array<{ cleanup(): void }> = [];
function fakeHome() {
  const home = makeDir("lg-home-");
  homes.push(home);
  vi.stubEnv("HOME", home.root);
  vi.stubEnv("USERPROFILE", home.root);
  return home;
}
afterEach(() => {
  vi.unstubAllEnvs();
  while (homes.length) homes.pop()!.cleanup();
});

/** Scanners where only the pack path may run: anything repo-shaped fails the test. */
function packOnly(entries: TarEntry[] | null | Buffer): Scanners {
  const never = (name: string) => () => {
    throw new Error(`${name} must not run in pack mode`);
  };
  return {
    listFiles: never("listFiles") as Scanners["listFiles"],
    history: never("history") as Scanners["history"],
    reachability: never("reachability") as Scanners["reachability"],
    basics: never("basics") as Scanners["basics"],
    isRepoRoot: never("isRepoRoot") as Scanners["isRepoRoot"],
    secrets: scanSecrets,
    terms: scanTerms,
    pack(_cwd, dest) {
      if (entries === null) return null;
      const file = join(dest, "demo-1.0.0.tgz");
      writeFileSync(file, Buffer.isBuffer(entries) ? entries : makeTgz(entries));
      return file;
    },
  } as Scanners;
}

describe("--pack arguments", () => {
  it.each([
    [["--pack", "--init-list"]],
    [["--pack", "--print-hook"]],
    [["--pack", "--pack"]],
    [["--pack", "a", "b"]],
  ])("rejects %j with exit 2 and the usage hint", async (argv) => {
    const c = capture();
    expect(await main(argv, c.io)).toBe(2);
    expect(c.err.join("")).toContain("Usage: launch-guard");
    expect(c.out).toEqual([]);
  });

  it("--help documents --pack and says it never runs scripts", async () => {
    const c = capture();
    expect(await main(["--help"], c.io)).toBe(0);
    const text = c.out.join("");
    expect(text).toContain("--pack");
    expect(text).toMatch(/does not run .*scripts/i);
  });
});

describe("--pack with a fake npm pack", () => {
  it("exit 1 on a blocking finding; text report; no key, no temp path, no repo-only checks", async () => {
    const home = fakeHome();
    const src = makeDir("lg-psrc-");
    try {
      const c = capture();
      const code = await main(
        [src.root, "--pack", "--offline"],
        c.io,
        packOnly([
          { name: "package/package.json", data: '{"name":"demo","files":["dist"]}' },
          { name: "package/dist/config.js", data: `x = "${FAKE_AWS}";\n` },
          { name: "package/.claude/settings.local.json", data: "{}" },
        ]),
      );
      expect(code).toBe(1);
      const text = c.out.join("");
      expect(text).toContain("BLOCK");
      expect(text).toContain("dist/config.js:1 secret format");
      expect(text).toContain(".claude/settings.local.json agent folder in package");
      expect(text.trimEnd().endsWith("RESULT: FAIL")).toBe(true);
      expect(c.all()).not.toContain(FAKE_AWS);
      expect(c.all()).not.toContain("lg-pack-");
      expect(c.all()).not.toContain("not a repository root");
    } finally {
      src.cleanup();
      home.cleanup();
    }
  }, SLOW);

  it("exit 0 for a clean package, with --json in the unchanged six-field shape", async () => {
    const home = fakeHome();
    const src = makeDir("lg-psrc-");
    try {
      const c = capture();
      const code = await main(
        [src.root, "--pack", "--json"],
        c.io,
        packOnly([
          { name: "package/package.json", data: '{"name":"demo","files":["index.js"]}' },
          { name: "package/index.js", data: "module.exports = 1;\n" },
        ]),
      );
      expect(code).toBe(0);
      const report = JSON.parse(c.out.join(""));
      expect(report.version).toBe(1);
      expect(report.result).toBe("pass");
      expect(report.counts.block).toBe(0);
      for (const f of report.findings) expect(Object.keys(f).sort()).toEqual(["category", "entry", "file", "label", "line", "severity"]);
      expect(report.findings.map((f: { label: string }) => f.label)).toContain("package contents");
    } finally {
      src.cleanup();
      home.cleanup();
    }
  });

  it("--fail-on warn makes a warning-only package fail", async () => {
    const home = fakeHome();
    const src = makeDir("lg-psrc-");
    try {
      const warnOnly = () => packOnly([{ name: "package/package.json", data: '{"name":"demo"}' }, { name: "package/index.js", data: "1\n" }]);
      const lenient = capture();
      expect(await main([src.root, "--pack"], lenient.io, warnOnly())).toBe(0);
      expect(lenient.out.join("")).toContain("no files list in package");
      const strict = capture();
      expect(await main([src.root, "--pack", "--fail-on", "warn"], strict.io, warnOnly())).toBe(1);
      expect(strict.out.join("").trimEnd().endsWith("RESULT: FAIL")).toBe(true);
    } finally {
      src.cleanup();
      home.cleanup();
    }
  });

  it("exit 2 with a fixed message when the package cannot be built", async () => {
    const home = fakeHome();
    const src = makeDir("lg-psrc-");
    try {
      const c = capture();
      expect(await main([src.root, "--pack"], c.io, packOnly(null))).toBe(2);
      expect(c.out).toEqual([]);
      expect(c.err.join("")).toBe("launch-guard: the package could not be built.\n");
    } finally {
      src.cleanup();
      home.cleanup();
    }
  });

  it("exit 2 with a fixed message when the tarball is damaged", async () => {
    const home = fakeHome();
    const src = makeDir("lg-psrc-");
    try {
      const c = capture();
      expect(await main([src.root, "--pack"], c.io, packOnly(Buffer.from("garbage")))).toBe(2);
      expect(c.out).toEqual([]);
      expect(c.err.join("")).toBe("launch-guard: the package could not be read.\n");
    } finally {
      src.cleanup();
      home.cleanup();
    }
  });

  it("still exits 2 for a path that is not a directory", async () => {
    const home = fakeHome();
    try {
      const c = capture();
      expect(await main(["no-such-folder-zq", "--pack"], c.io, packOnly([]))).toBe(2);
      expect(c.err.join("")).toContain("not a readable directory");
    } finally {
      home.cleanup();
    }
  });
});

// Runs the real npm; skipped when it is not on PATH (the fake-npm tests above still run).
describe.skipIf(!NPM_OK)("--pack with the real npm (needs npm on PATH)", () => {
  it(
    "blocks a throwaway package that would ship an agent folder and a key, without printing either",
    async () => {
      const home = fakeHome();
      const src = makeDir("lg-preal-");
      try {
        src.write("package.json", JSON.stringify({ name: "demo-pack", version: "1.0.0", main: "index.js" }));
        src.write("index.js", `module.exports = { aws: "${FAKE_AWS}" };\n`);
        src.write(".claude/settings.local.json", "{}\n");
        const c = capture();
        expect(await main([src.root, "--pack", "--offline"], c.io)).toBe(1);
        const text = c.out.join("");
        expect(text).toContain("index.js:1 secret format");
        expect(text).toContain(".claude/settings.local.json agent folder in package");
        expect(text).toContain("no files list in package");
        expect(text).toContain("packed without running scripts");
        expect(c.all()).not.toContain(FAKE_AWS);
        expect(c.all().toLowerCase()).not.toContain(src.root.toLowerCase().replace(/\\/g, "/"));
        expect(c.all().toLowerCase()).not.toContain(src.root.toLowerCase());
      } finally {
        src.cleanup();
        home.cleanup();
      }
    },
    SLOW,
  );

  it(
    "passes a clean package",
    async () => {
      const home = fakeHome();
      const src = makeDir("lg-preal-");
      try {
        src.write("package.json", JSON.stringify({ name: "demo-pack", version: "1.0.0", files: ["index.js"] }));
        src.write("index.js", "module.exports = 1;\n");
        const c = capture();
        expect(await main([src.root, "--pack", "--offline"], c.io)).toBe(0);
        expect(c.out.join("").trimEnd().endsWith("RESULT: PASS")).toBe(true);
      } finally {
        src.cleanup();
        home.cleanup();
      }
    },
    SLOW,
  );

  it(
    "exit 2 when the folder has no package.json",
    async () => {
      const home = fakeHome();
      const src = makeDir("lg-preal-");
      try {
        src.write("a.txt", "x");
        const c = capture();
        expect(await main([src.root, "--pack"], c.io)).toBe(2);
        expect(c.err.join("")).toBe("launch-guard: the package could not be built.\n");
      } finally {
        src.cleanup();
        home.cleanup();
      }
    },
    SLOW,
  );
});

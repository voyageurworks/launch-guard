import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeDir } from "../testRepos.js";
import { NPM_OK } from "../testNpm.js";
import { runNpmPack } from "./build.js";

const SLOW = 120_000;
const dirs: Array<{ cleanup(): void }> = [];
function dir(prefix: string, files: Record<string, string> = {}) {
  const d = makeDir(prefix);
  dirs.push(d);
  for (const [p, t] of Object.entries(files)) d.write(p, t);
  return d;
}
afterEach(() => {
  while (dirs.length) dirs.pop()!.cleanup();
});

// These tests run the real npm; without it on PATH they are skipped (the fake-npm tests elsewhere still run).
describe.skipIf(!NPM_OK)("runNpmPack (needs npm on PATH)", () => {
  it(
    "packs a package into the destination and returns the tarball path",
    () => {
      const src = dir("lg-src-", { "package.json": '{"name":"demo","version":"1.0.0"}', "index.js": "1" });
      const out = dir("lg-out-");
      const tgz = runNpmPack(src.root, out.root);
      expect(tgz).not.toBeNull();
      expect(existsSync(tgz!)).toBe(true);
      expect(tgz!.startsWith(out.root)).toBe(true);
      expect(tgz!.endsWith(".tgz")).toBe(true);
    },
    SLOW,
  );

  it(
    "never runs lifecycle scripts",
    () => {
      const marker = "ran.txt";
      const script = `node -e "require('fs').writeFileSync('${marker}','x')"`;
      const src = dir("lg-src-", {
        "package.json": JSON.stringify({ name: "demo", version: "1.0.0", scripts: { prepack: script, prepare: script, postpack: script } }),
        "index.js": "1",
      });
      const out = dir("lg-out-");
      expect(runNpmPack(src.root, out.root)).not.toBeNull();
      expect(existsSync(join(src.root, marker))).toBe(false);
    },
    SLOW,
  );

  it(
    "returns null when there is no package.json",
    () => {
      const src = dir("lg-src-", { "a.txt": "x" });
      const out = dir("lg-out-");
      expect(runNpmPack(src.root, out.root)).toBeNull();
    },
    SLOW,
  );

  it(
    "returns null for an invalid package.json",
    () => {
      const src = dir("lg-src-", { "package.json": "{ broken" });
      const out = dir("lg-out-");
      expect(runNpmPack(src.root, out.root)).toBeNull();
    },
    SLOW,
  );

  it("returns null when the timeout is far too short", () => {
    const src = dir("lg-src-", { "package.json": '{"name":"demo","version":"1.0.0"}' });
    const out = dir("lg-out-");
    expect(runNpmPack(src.root, out.root, 1)).toBeNull();
  });

  it(
    "does not pack a parent package when the target folder has no package.json of its own",
    () => {
      const parent = dir("lg-parent-", { "package.json": '{"name":"parent","version":"1.0.0"}', "child/a.txt": "x" });
      const out = dir("lg-out-");
      expect(runNpmPack(join(parent.root, "child"), out.root)).toBeNull();
    },
    SLOW,
  );

  it("returns null for a missing folder", () => {
    const out = dir("lg-out-");
    expect(runNpmPack(join(out.root, "nope"), out.root)).toBeNull();
  });
});

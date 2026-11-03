import { existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { makeDir } from "../testRepos.js";
import { NPM_OK } from "../testNpm.js";
import { runNpmPack } from "./build.js";
import { extractTarball } from "./tar.js";

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

  describe("a project that defines pack-time lifecycle scripts (packed from a sanitized copy)", () => {
    const script = (marker: string) => `node -e "require('fs').writeFileSync('${marker}','x')"`;
    const scripts = { prepack: script("a.txt"), prepare: script("b.txt"), postpack: script("c.txt"), prepublishOnly: script("d.txt"), test: "vitest" };

    function listTarball(tgz: string, into: string) {
      return extractTarball(readFileSync(tgz), into);
    }

    it(
      "runs none of them, leaves the project's files untouched, and still produces the tarball",
      () => {
        const pkgJson = JSON.stringify({ name: "demo", version: "1.0.0", scripts }, null, 2) + "\n";
        const src = dir("lg-src-", { "package.json": pkgJson, "index.js": "1" });
        const out = dir("lg-out-");
        const tgz = runNpmPack(src.root, out.root);
        expect(tgz).not.toBeNull();
        for (const m of ["a.txt", "b.txt", "c.txt", "d.txt"]) expect(existsSync(join(src.root, m))).toBe(false);
        expect(readFileSync(join(src.root, "package.json"), "utf8")).toBe(pkgJson);
        expect(readdirSync(src.root).sort()).toEqual(["index.js", "package.json"]);
      },
      SLOW,
    );

    it(
      "keeps what npm would ship: honours .gitignore, leaves out .git, strips only the lifecycle scripts",
      () => {
        const src = dir("lg-src-", {
          "package.json": JSON.stringify({ name: "demo", version: "1.0.0", scripts }),
          "index.js": "1",
          ".gitignore": "secret.txt\n",
          "secret.txt": "x",
          ".git/config": "[core]\n",
          "lib/util.js": "2",
        });
        const out = dir("lg-out-");
        const unpack = dir("lg-unpack-");
        const tgz = runNpmPack(src.root, out.root);
        expect(tgz).not.toBeNull();
        const r = listTarball(tgz!, unpack.root);
        expect(r.files.sort()).toEqual(["index.js", "lib/util.js", "package.json"]);
        const packed = JSON.parse(readFileSync(join(unpack.root, "package.json"), "utf8"));
        expect(packed.scripts).toEqual({ test: "vitest" });
      },
      SLOW,
    );

    it(
      "still includes a bundled dependency from the project's node_modules",
      () => {
        const src = dir("lg-src-", {
          "package.json": JSON.stringify({ name: "demo", version: "1.0.0", bundleDependencies: ["dep"], dependencies: { dep: "1.0.0" }, scripts }),
          "index.js": "1",
          "node_modules/dep/package.json": '{"name":"dep","version":"1.0.0"}',
          "node_modules/dep/index.js": "3",
        });
        const out = dir("lg-out-");
        const unpack = dir("lg-unpack-");
        const tgz = runNpmPack(src.root, out.root);
        expect(tgz).not.toBeNull();
        expect(listTarball(tgz!, unpack.root).files).toContain("node_modules/dep/index.js");
        // Deleting the temporary copy must not follow its link back into the project's own node_modules.
        expect(readFileSync(join(src.root, "node_modules/dep/index.js"), "utf8")).toBe("3");
      },
      SLOW,
    );

    it(
      "removes its temporary copy afterwards",
      () => {
        const before = readdirSync(tmpdir()).filter((n) => n.startsWith("lg-packsrc-"));
        const src = dir("lg-src-", { "package.json": JSON.stringify({ name: "demo", version: "1.0.0", scripts }), "index.js": "1" });
        const out = dir("lg-out-");
        expect(runNpmPack(src.root, out.root)).not.toBeNull();
        const after = readdirSync(tmpdir()).filter((n) => n.startsWith("lg-packsrc-"));
        expect(after).toEqual(before);
      },
      SLOW,
    );
  });

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

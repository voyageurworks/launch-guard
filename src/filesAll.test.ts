import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { listRepoFiles } from "./files.js";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("listRepoFiles with includeAll (pack mode)", () => {
  it("walks .git, node_modules and dist, which the default walk skips", () => {
    dir = mkdtempSync(join(tmpdir(), "lg-all-"));
    writeFileSync(join(dir, "a.txt"), "a");
    for (const d of [".git", "node_modules/dep", "dist"]) {
      mkdirSync(join(dir, d), { recursive: true });
      writeFileSync(join(dir, d, "x.txt"), "x");
    }
    const normal = listRepoFiles(dir).map((f) => f.path).sort();
    expect(normal).toEqual(["a.txt"]);
    const all = listRepoFiles(dir, undefined, { includeAll: true }).map((f) => f.path).sort();
    expect(all).toEqual([".git/x.txt", "a.txt", "dist/x.txt", "node_modules/dep/x.txt"]);
  });

  it("does not ask git even when the folder has a .git entry", () => {
    dir = mkdtempSync(join(tmpdir(), "lg-all-"));
    mkdirSync(join(dir, ".git"));
    writeFileSync(join(dir, ".git", "config"), "[core]\n");
    writeFileSync(join(dir, "b.txt"), "b");
    const all = listRepoFiles(dir, undefined, { includeAll: true }).map((f) => f.path).sort();
    expect(all).toEqual([".git/config", "b.txt"]);
  });
});

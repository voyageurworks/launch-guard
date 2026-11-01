import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { isEnvFile, listRepoFiles } from "./files.js";
import { makeDir, makeRepo } from "./testRepos.js";

// Opening any file whose name contains "locked" fails, standing in for a locked or vanished file.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync: ((path: string, ...rest: unknown[]) => {
      if (String(path).includes("locked")) throw new Error("EBUSY");
      return (actual.openSync as (...a: unknown[]) => number)(path, ...rest);
    }) as typeof actual.openSync,
  };
});

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

describe("listRepoFiles", () => {
  it("skips binary, large and symlinked files and reports why", () => {
    dir = mkdtempSync(join(tmpdir(), "lg-files-"));
    writeFileSync(join(dir, "a.txt"), "hello");
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.txt"), "world");
    writeFileSync(join(dir, "bin.dat"), Buffer.from([1, 2, 0, 3]));
    writeFileSync(join(dir, "big.txt"), Buffer.alloc(1024 * 1024 + 1, 97));
    for (const skipped of [".git", "node_modules", "dist"]) {
      mkdirSync(join(dir, skipped));
      writeFileSync(join(dir, skipped, "x.txt"), "x");
    }
    let linked = true;
    try {
      symlinkSync(join(dir, "a.txt"), join(dir, "link.txt"));
    } catch {
      linked = false; // symlink creation needs privileges on Windows
    }

    const byPath = Object.fromEntries(listRepoFiles(dir).map((f) => [f.path, f.skipped]));
    expect(byPath["a.txt"]).toBeUndefined();
    expect(byPath["sub/b.txt"]).toBeUndefined();
    expect(byPath["bin.dat"]).toBe("binary");
    expect(byPath["big.txt"]).toBe("large");
    expect(Object.keys(byPath).some((p) => /^(\.git|node_modules|dist)\//.test(p))).toBe(false);
    if (linked) expect(byPath["link.txt"]).toBe("symlink");
    else console.warn("symlink case skipped: cannot create symlinks here");
  });

  it("skips an unreadable file instead of aborting the walk", () => {
    dir = mkdtempSync(join(tmpdir(), "lg-files-"));
    writeFileSync(join(dir, "locked.txt"), "x");
    writeFileSync(join(dir, "ok.txt"), "y");
    const byPath = Object.fromEntries(listRepoFiles(dir).map((f) => [f.path, f.skipped]));
    expect(byPath["locked.txt"]).toBe("unreadable");
    expect(byPath["ok.txt"]).toBeUndefined();
  });
});

describe("listRepoFiles in a git repo", () => {
  it("lists tracked and untracked-not-ignored files but not ignored ones", () => {
    const repo = makeRepo();
    try {
      repo.write(".gitignore", "ignored.txt\n");
      repo.write("tracked.txt", "t");
      repo.write("ignored.txt", "i");
      repo.write("sub/new.txt", "n");
      repo.git("add", "tracked.txt");
      const paths = listRepoFiles(repo.root).map((f) => f.path).sort();
      expect(paths).toEqual([".gitignore", "sub/new.txt", "tracked.txt"]);
    } finally {
      repo.cleanup();
    }
  }, 120_000);

  it("still walks everything when there is no .git", () => {
    const d = makeDir();
    try {
      d.write(".gitignore", "ignored.txt\n");
      d.write("ignored.txt", "i");
      d.write("a/b.txt", "b");
      expect(listRepoFiles(d.root).map((f) => f.path).sort()).toEqual([".gitignore", "a/b.txt", "ignored.txt"]);
    } finally {
      d.cleanup();
    }
  });

  it("ignores a tracked file that was deleted from the working tree", () => {
    const repo = makeRepo();
    try {
      repo.commit("one", { "gone.txt": "g", "kept.txt": "k" });
      rmSync(join(repo.root, "gone.txt"));
      expect(listRepoFiles(repo.root)).toEqual([{ path: "kept.txt" }]);
    } finally {
      repo.cleanup();
    }
  }, 120_000);
});

describe("isEnvFile", () => {
  it("flags .env files by name, not the example, sample or template ones", () => {
    expect(isEnvFile(".env")).toBe(true);
    expect(isEnvFile("app/.env.production")).toBe(true);
    expect(isEnvFile(".env.example")).toBe(false);
    expect(isEnvFile("src/env.ts")).toBe(false);
  });
});

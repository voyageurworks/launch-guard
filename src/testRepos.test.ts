import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { makeDir } from "./testRepos.js";

describe("makeDir cleanup", () => {
  it("removes the folder and its contents", () => {
    const d = makeDir("lg-cleanup-");
    d.write("a/b.txt", "x");
    d.cleanup();
    expect(existsSync(d.root)).toBe(false);
  });

  // On Windows a folder cannot be removed while any process (such as a git child that outlived its parent) has it as its
  // working directory. That made whole test runs fail with EBUSY after the assertions had passed; cleanup of a temp
  // folder must never do that.
  it.skipIf(process.platform !== "win32")("does not throw while a process still runs inside the folder, and removes it once that process is gone", async () => {
    const d = makeDir("lg-cleanup-");
    d.write("a.txt", "x");
    const child = spawn(process.execPath, ["-e", "setTimeout(() => {}, 120000)"], { cwd: d.root, stdio: "ignore" });
    await new Promise((resolve) => setTimeout(resolve, 500)); // let it start inside the folder
    try {
      expect(() => d.cleanup()).not.toThrow();
      expect(existsSync(d.root)).toBe(true);
    } finally {
      child.kill();
      await new Promise((resolve) => child.once("exit", resolve));
    }
    d.cleanup();
    expect(existsSync(d.root)).toBe(false);
  }, 120_000);
});

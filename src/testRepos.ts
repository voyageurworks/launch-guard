import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export interface Identity {
  name: string;
  email: string;
}

export const NEUTRAL: Identity = { name: "Test Person", email: "test@example.invalid" };

/** A throwaway git repo in a temp dir. Test helper only; excluded from the build. */
export interface TestRepo {
  root: string;
  git(...args: string[]): string;
  write(path: string, text: string): void;
  /** Writes `files`, stages everything and commits as `who` (default neutral identity). */
  commit(message: string, files?: Record<string, string>, who?: Identity): void;
  cleanup(): void;
}

/**
 * Every helper here runs git synchronously, which blocks the worker's event loop, so vitest's own test timeout can
 * not fire while a child hangs. A per-call timeout turns a stuck git into a prompt, named error.
 */
const GIT_TIMEOUT = 60_000;

/**
 * Removes a temp folder, retrying while something still has it open. On Windows a killed git child can keep a folder
 * locked for longer than a short retry budget, which failed whole test runs with EBUSY after every assertion had
 * passed. A temp folder that stays locked is left behind (the runner discards it) instead of failing the test.
 */
export function removeDir(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true, maxRetries: 30, retryDelay: 200 });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (process.platform === "win32" && (code === "EBUSY" || code === "EPERM" || code === "ENOTEMPTY" || code === "EACCES")) return;
    throw err;
  }
}

/** Plain temp dir with no git inside. */
export function makeDir(prefix = "lg-test-"): { root: string; write(path: string, text: string): void; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return {
    root,
    write(path, text) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    },
    cleanup: () => removeDir(root),
  };
}

export function makeRepo(prefix = "lg-repo-"): TestRepo {
  const dir = makeDir(prefix);
  const run = (cwd: string, env: Record<string, string>, args: string[]): string =>
    execFileSync("git", args, { cwd, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT });
  const ident = (who: Identity): Record<string, string> => ({
    GIT_AUTHOR_NAME: who.name,
    GIT_AUTHOR_EMAIL: who.email,
    GIT_COMMITTER_NAME: who.name,
    GIT_COMMITTER_EMAIL: who.email,
  });
  run(dir.root, {}, ["init", "-q"]);
  run(dir.root, {}, ["config", "core.autocrlf", "false"]);
  run(dir.root, {}, ["config", "commit.gpgsign", "false"]);
  return {
    root: dir.root,
    git: (...args) => run(dir.root, ident(NEUTRAL), args),
    write: dir.write,
    commit(message, files = {}, who = NEUTRAL) {
      for (const [p, text] of Object.entries(files)) dir.write(p, text);
      run(dir.root, ident(who), ["add", "-A"]);
      run(dir.root, ident(who), ["commit", "-q", "--allow-empty", "-m", message]);
    },
    cleanup: dir.cleanup,
  };
}

/** A bare repo in a temp dir, usable as a local remote. Test helper only. */
export function makeBareRemote(): { root: string; git(...args: string[]): string; cleanup(): void } {
  const dir = makeDir("lg-bare-");
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: dir.root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: GIT_TIMEOUT });
  git("init", "--bare", "-q");
  return { root: dir.root, git, cleanup: dir.cleanup };
}

/** A depth-1 clone of `source` in a temp dir (it has to be a file:// URL for git to honour --depth). */
export function shallowClone(source: TestRepo): { root: string; cleanup(): void } {
  const dir = makeDir("lg-shallow-");
  execFileSync("git", ["clone", "-q", "--depth", "1", pathToFileURL(source.root).href, dir.root], { stdio: "ignore", timeout: GIT_TIMEOUT });
  return { root: dir.root, cleanup: dir.cleanup };
}

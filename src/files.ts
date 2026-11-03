import { execFileSync } from "node:child_process";
import type { Dirent } from "node:fs";
import { closeSync, existsSync, lstatSync, openSync, readSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { GIT_QUICK_TIMEOUT_MS } from "./gitTimeouts.js";

export interface RepoFile {
  path: string;
  skipped?: "binary" | "large" | "symlink" | "unreadable";
}

const SKIP_DIRS = new Set([".git", "node_modules", "dist"]);
const MAX_BYTES = 1024 * 1024;
const SNIFF_BYTES = 8192;
const ENV_FILE = /^\.env/i;
const ENV_TEMPLATES = new Set([".env.example", ".env.sample", ".env.template"]);

/** True for `.env*` files other than the example/sample/template ones. Decided from the name alone. */
export function isEnvFile(path: string): boolean {
  const name = basename(path).toLowerCase();
  return ENV_FILE.test(name) && !ENV_TEMPLATES.has(name);
}

function hasNul(file: string): boolean {
  const fd = openSync(file, "r");
  try {
    const buf = Buffer.alloc(SNIFF_BYTES);
    const n = readSync(fd, buf, 0, SNIFF_BYTES, 0);
    return buf.subarray(0, n).includes(0);
  } finally {
    closeSync(fd);
  }
}

/** Tracked plus untracked-not-ignored paths per git, or null when git is unavailable or fails. */
function gitPaths(root: string): string[] | null {
  if (!existsSync(join(root, ".git"))) return null;
  try {
    const out = execFileSync("git", ["-c", "core.fsmonitor=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: GIT_QUICK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set(out.split("\0").filter((p) => p !== ""))];
  } catch {
    return null;
  }
}

/**
 * Relative, forward-slash paths of every file under root. Symlinks are never followed.
 * In a git repo the list comes from `git ls-files` (tracked and untracked-not-ignored files); otherwise the
 * folder is walked. Files for which `neverOpen(path)` is true are listed without being opened (no binary sniff).
 */
export function listRepoFiles(root: string, neverOpen?: (path: string) => boolean, options: { includeAll?: boolean } = {}): RepoFile[] {
  // includeAll is for an unpacked package: ignore git, and walk .git, node_modules and dist too, since they are what ships.
  /** Classifies one path; undefined means leave it out (a directory or a file that vanished). */
  const classify = (path: string): RepoFile | undefined => {
    const full = join(root, path);
    try {
      const st = lstatSync(full);
      if (st.isSymbolicLink()) return { path, skipped: "symlink" };
      if (!st.isFile()) return undefined;
      if (st.size > MAX_BYTES) return { path, skipped: "large" };
      if (neverOpen?.(path)) return { path };
      return hasNul(full) ? { path, skipped: "binary" } : { path };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ENOENT") return undefined; // deleted since git listed it
      return { path, skipped: "unreadable" };
    }
  };

  const listed = options.includeAll ? null : gitPaths(root);
  if (listed) {
    const out: RepoFile[] = [];
    for (const path of listed) {
      const f = classify(path);
      if (f) out.push(f);
    }
    return out;
  }

  const out: RepoFile[] = [];
  const walk = (rel: string): void => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(root, rel), { withFileTypes: true });
    } catch {
      if (rel) out.push({ path: rel, skipped: "unreadable" });
      return;
    }
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      let isDir = false;
      try {
        isDir = lstatSync(join(root, path)).isDirectory();
      } catch {
        // classify reports it as unreadable
      }
      if (isDir) {
        if (options.includeAll || !SKIP_DIRS.has(entry.name)) walk(path);
        continue;
      }
      const f = classify(path);
      if (f) out.push(f);
    }
  };
  walk("");
  return out;
}

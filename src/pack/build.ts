import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const NPM_PACK_TIMEOUT_MS = 120_000;

/**
 * Scripts that npm may run around `npm pack` or `npm publish`. `--ignore-scripts` is not trusted to stop them: npm 10
 * (the npm that ships with Node 22) still runs `prepare` during `npm pack --ignore-scripts`. A project that defines any
 * of them is therefore packed from a sanitized copy in which they are removed.
 */
const PACK_SCRIPTS = ["prepublish", "prepublishOnly", "prepack", "prepare", "postpack", "publish", "postpublish"];
const COPY_MAX_FILES = 50_000;
const COPY_MAX_BYTES = 256 * 1024 * 1024;

type Manifest = Record<string, unknown>;

/** The project's package.json as an object, or null when it is missing, unreadable or not a JSON object. */
function readManifest(cwd: string): Manifest | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(cwd, "package.json"), "utf8"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Manifest) : null;
  } catch {
    return null;
  }
}

function definesPackScripts(manifest: Manifest): boolean {
  const scripts = manifest.scripts;
  return typeof scripts === "object" && scripts !== null && PACK_SCRIPTS.some((k) => k in (scripts as Manifest));
}

/**
 * Copies the project into `dst` without `.git`, any `node_modules` folder (the top-level one is linked back so bundled
 * dependencies are still packed) or symbolic links, and writes a package.json with the pack-time scripts removed. The
 * project itself is never changed. Returns false when the project is larger than the copy limits.
 */
function copySanitized(src: string, dst: string, manifest: Manifest): boolean {
  let files = 0;
  let bytes = 0;
  const walk = (rel: string): boolean => {
    for (const entry of readdirSync(join(src, rel), { withFileTypes: true })) {
      if (entry.name === ".git" || entry.name === "node_modules") continue;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      const st = lstatSync(join(src, path));
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        mkdirSync(join(dst, path));
        if (!walk(path)) return false;
      } else if (st.isFile()) {
        files++;
        bytes += st.size;
        if (files > COPY_MAX_FILES || bytes > COPY_MAX_BYTES) return false;
        copyFileSync(join(src, path), join(dst, path));
      }
    }
    return true;
  };
  if (!walk("")) return false;
  const scripts = { ...(manifest.scripts as Manifest) };
  for (const key of PACK_SCRIPTS) delete scripts[key];
  writeFileSync(join(dst, "package.json"), JSON.stringify({ ...manifest, scripts }, null, 2) + "\n");
  const modules = join(src, "node_modules");
  if (existsSync(modules)) {
    try {
      symlinkSync(realpathSync(modules), join(dst, "node_modules"), "junction");
    } catch {
      // without the link only bundled dependencies are missing from the package
    }
  }
  return true;
}

/**
 * Runs `npm pack` for the project in `cwd` and writes the tarball into `destDir`, which must already exist.
 * Lifecycle scripts never run (`--ignore-scripts`), nothing is published, and the tool's own output is discarded
 * so no text from the project or from npm reaches the report. Returns the tarball path, or null when npm is
 * missing, fails, times out or produced anything other than exactly one .tgz.
 */
export function runNpmPack(cwd: string, destDir: string, timeoutMs: number = NPM_PACK_TIMEOUT_MS): string | null {
  try {
    if (!statSync(cwd).isDirectory()) return null;
    // Some npm versions look upward for a project. Only the folder that was asked for may be packed, never a parent.
    if (!statSync(join(cwd, "package.json")).isFile()) return null;
  } catch {
    return null;
  }
  const manifest = readManifest(cwd);
  if (manifest === null) return null;
  let copy: string | null = null;
  try {
    let packCwd = cwd;
    if (definesPackScripts(manifest)) {
      copy = mkdtempSync(join(tmpdir(), "lg-packsrc-"));
      if (!copySanitized(cwd, copy, manifest)) return null;
      packCwd = copy;
    }
    return spawnPack(packCwd, destDir, timeoutMs);
  } catch {
    return null;
  } finally {
    if (copy !== null) rmSync(copy, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

/** Runs `npm pack --ignore-scripts` in `cwd` (a folder with no pack-time scripts left) and returns the single tarball path, or null. */
function spawnPack(cwd: string, destDir: string, timeoutMs: number): string | null {
  const args = ["pack", "--ignore-scripts", "--pack-destination", destDir];
  // Node refuses to spawn .cmd files directly on Windows, so npm goes through the command interpreter there.
  const windows = process.platform === "win32";
  const command = windows ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const argv = windows ? ["/d", "/s", "/c", "npm", ...args] : args;
  const result = spawnSync(command, argv, {
    cwd,
    timeout: timeoutMs,
    stdio: ["ignore", "ignore", "ignore"],
    windowsHide: true,
    env: {
      ...process.env,
      npm_config_ignore_scripts: "true",
      npm_config_update_notifier: "false",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_logs_max: "0",
    },
  });
  if (result.error || result.status !== 0) return null;
  try {
    const tarballs = readdirSync(destDir).filter((n) => n.endsWith(".tgz"));
    return tarballs.length === 1 ? join(destDir, tarballs[0]!) : null;
  } catch {
    return null;
  }
}

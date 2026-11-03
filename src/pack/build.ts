import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const NPM_PACK_TIMEOUT_MS = 120_000;

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

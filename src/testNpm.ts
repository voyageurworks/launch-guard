import { spawnSync } from "node:child_process";

/** Test helper only (excluded from the build): true when `npm` can be run, so real-npm tests can skip with a clear reason. */
function probe(): boolean {
  const windows = process.platform === "win32";
  const command = windows ? (process.env.ComSpec ?? "cmd.exe") : "npm";
  const argv = windows ? ["/d", "/s", "/c", "npm", "--version"] : ["--version"];
  const r = spawnSync(command, argv, { stdio: "ignore", timeout: 60_000, windowsHide: true });
  return !r.error && r.status === 0;
}

export const NPM_OK = probe();

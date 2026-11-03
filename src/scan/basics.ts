import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { GIT_QUICK_TIMEOUT_MS } from "../gitTimeouts.js";
import { join } from "node:path";
import { downgrade, isAllowed } from "../allow.js";
import { displayPath } from "../denylist.js";
import type { DenyEntry } from "../denylist.js";
import { isEnvFile, listRepoFiles } from "../files.js";
import type { RepoFile } from "../files.js";
import type { Finding, Label } from "../types.js";

const AI_NAMES = new Set(["claude.md", "agents.md", "gemini.md", ".cursorrules"]);
const AI_DIRS = new Set([".claude", ".codex", ".cursor", ".windsurf"]);

/** True for AI-assistant files, memory files and session notes (decided from the path alone). */
export function isAiFile(path: string): boolean {
  const parts = path.toLowerCase().split("/");
  const name = parts[parts.length - 1];
  const dirs = parts.slice(0, -1);
  if (AI_NAMES.has(name)) return true;
  if (path.toLowerCase() === ".github/copilot-instructions.md") return true;
  if (dirs.some((d) => AI_DIRS.has(d) || d === "memory")) return true;
  return /(?:session|transcript)/.test(name) && /\.(?:md|json|jsonl)$/.test(name);
}

/**
 * Windows form: the drive letter is its own boundary, "Users" is case-insensitive, backslashes may be doubled
 * (JSON). Group 1 is the two-word placeholder "All Users", group 2 any other name. Braces and percent signs
 * stay in the name so ${USER} and %USERNAME% read as placeholders.
 */
const WIN_PROFILE = /(?<![A-Za-z0-9_])[a-z]:[\\/]+users[\\/]+(?:(all users)(?!\w)|([^\\/\s"'`<>()[\],;]+))/gi;
/** POSIX forms: case-sensitive, and only after a left boundary, so URLs and routes do not match. Group 1 is the name. */
const POSIX_PROFILE = /(?<=^|[\s"'`(\[=,<])(?:\/Users\/|\/home\/)([^\\/\s"'`<>()[\],;]+)/g;

const PLACEHOLDERS = new Set(
  [
    "%username%", "$user", "${user}", "~", "username", "user", "you", "yourname", "your-name",
    "example", "me", "public", "default", "all users", "runner", "vscode", "node",
  ].map((s) => s.toLowerCase()),
);

/** True when the line names a real-looking profile folder. Never returns the name. */
function hasProfilePath(line: string): boolean {
  const names: string[] = [];
  for (const m of line.matchAll(WIN_PROFILE)) if (!m[1]) names.push(m[2]);
  for (const m of line.matchAll(POSIX_PROFILE)) names.push(m[1]);
  return names.some((n) => {
    const raw = n.toLowerCase();
    const trimmed = raw.replace(/[.:]+$/, "");
    return trimmed !== "" && !PLACEHOLDERS.has(raw) && !PLACEHOLDERS.has(trimmed);
  });
}

/**
 * True when an untracked folder is itself a git repository (it has its own `.git`). Git lists such a folder as
 * `name/`; its files and history are not part of this scan, and a plain `git add` would not publish them either.
 */
function hasNestedRepo(root: string): boolean {
  try {
    const untracked = execFileSync("git", ["-c", "core.fsmonitor=false", "ls-files", "-z", "--others", "--exclude-standard"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
      timeout: GIT_QUICK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return untracked
      .split("\0")
      .some((p) => p.endsWith("/") && existsSync(join(root, p, ".git")));
  } catch {
    return false;
  }
}

/** True when the index holds a gitlink (mode 160000), which is how git records a submodule. */
function hasGitlink(root: string): boolean {
  try {
    const index = execFileSync("git", ["-c", "core.fsmonitor=false", "ls-files", "-s"], {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: GIT_QUICK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return index.split(/\r?\n/).some((l) => l.startsWith("160000 "));
  } catch {
    return false;
  }
}

/**
 * Checks AI-assistant, memory and session files for absolute user-profile paths, and the repo for LICENSE,
 * SECURITY, a CI workflow and an active FUNDING.yml. Findings carry only fixed text, paths and line numbers.
 */
export function scanBasics(root: string, entries: DenyEntry[] = [], listing?: RepoFile[]): Finding[] {
  const files = listing ?? listRepoFiles(root, isEnvFile);
  const findings: Finding[] = scanAiFiles(root, entries, files);
  const lower = new Set(files.map((f) => f.path.toLowerCase()));
  return findings.concat(scanRepoBasics(root, files, lower));
}

/** The user-profile-path check on AI-assistant, memory and session files. Reads files only; it never runs git. */
export function scanAiFiles(root: string, entries: DenyEntry[], files: RepoFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of files) {
    if (f.skipped || isEnvFile(f.path) || !isAiFile(f.path)) continue;
    let text: string;
    try {
      text = readFileSync(join(root, f.path), "utf8");
    } catch {
      continue;
    }
    const shown = displayPath(f.path, entries);
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const previous = i > 0 ? lines[i - 1] : "";
      if (isAllowed(line, previous) || !hasProfilePath(line)) return;
      findings.push({
        category: "basics",
        severity: downgrade(f.path, "block"),
        file: shown,
        line: i + 1,
        label: "user profile path",
        entry: null,
      });
    });
  }
  return findings;
}

/** The repository-level checks (submodules, nested repositories, LICENSE, SECURITY, CI, FUNDING). These run git. */
function scanRepoBasics(root: string, files: RepoFile[], lower: Set<string>): Finding[] {
  const findings: Finding[] = [];

  // A submodule is another repository: its files and history are not part of this scan.
  if (lower.has(".gitmodules") || hasGitlink(root)) {
    findings.push({ category: "basics", severity: "info", file: "submodules", line: null, label: "submodule not scanned", entry: null });
  }

  if (hasNestedRepo(root)) {
    findings.push({ category: "basics", severity: "info", file: "nested repositories", line: null, label: "nested repository not scanned", entry: null });
  }

  const warn = (file: string, label: Label): void => {
    findings.push({ category: "basics", severity: "warn", file, line: null, label, entry: null });
  };
  const licenseNames = ["license", "license.md", "license.txt", "copying", "copying.md"];
  if (!licenseNames.some((n) => lower.has(n))) warn("LICENSE", "missing LICENSE");
  if (!["security.md", ".github/security.md", "docs/security.md"].some((n) => lower.has(n))) warn("SECURITY", "missing SECURITY");
  if (![...lower].some((p) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p))) warn("CI", "missing CI");

  const funding = files.find((f) => !f.skipped && /^\.github\/funding\.ya?ml$/i.test(f.path));
  if (funding) {
    try {
      const lines = readFileSync(join(root, funding.path), "utf8").split(/\r?\n/);
      const first = lines.findIndex((l) => l.trim() !== "" && !l.trim().startsWith("#"));
      if (first >= 0) {
        findings.push({
          category: "basics",
          severity: "warn",
          file: ".github/FUNDING.yml",
          line: first + 1,
          label: "funding file active",
          entry: null,
        });
      }
    } catch {
      // unreadable: nothing to report
    }
  }
  return findings;
}

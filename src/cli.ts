import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { defaultDenyListPath, displayPath, loadDenyList } from "./denylist.js";
import type { DenyEntry } from "./denylist.js";
import { GIT_QUICK_TIMEOUT_MS } from "./gitTimeouts.js";
import { isEnvFile, listRepoFiles } from "./files.js";
import type { RepoFile } from "./files.js";
import { renderJson, renderReport, exitCode } from "./report.js";
import { scanBasics } from "./scan/basics.js";
import { scanHistory } from "./scan/history.js";
import { checkReachability } from "./scan/reachability.js";
import { scanSecrets } from "./scan/secrets.js";
import { scanTerms } from "./scan/terms.js";
import type { Finding } from "./types.js";

export interface Io {
  out(s: string): void;
  err(s: string): void;
}

/** The scanner functions main wires together. Tests may replace them; the default is the real ones. */
export interface Scanners {
  /** Lists the repository files once per run; the result is handed to secrets, terms, basics and the skipped-file notes. */
  listFiles(root: string): RepoFile[];
  secrets(root: string, entries: DenyEntry[], files?: RepoFile[]): Finding[];
  terms(root: string, entries: DenyEntry[], listFile?: string, files?: RepoFile[]): Finding[];
  history(root: string, entries: DenyEntry[]): Finding[];
  reachability(root: string, offline: boolean): Finding[];
  basics(root: string, entries: DenyEntry[], files?: RepoFile[]): Finding[];
  /** True when `root` is the top level of a git working tree. Optional: a scanner set without it counts as a root. */
  isRepoRoot?(root: string): boolean;
}

const REAL: Scanners = {
  listFiles: (root) => listRepoFiles(root, isEnvFile),
  secrets: scanSecrets,
  terms: scanTerms,
  history: scanHistory,
  reachability: (root, offline) => checkReachability(root, { offline }),
  basics: scanBasics,
  isRepoRoot,
};

const MAX_SKIPPED_NOTES = 25;

const USAGE = [
  "Usage: launch-guard [path] [--list <file>] [--offline] [--json] [--init-list [file]] [--print-hook] [--help]",
  "",
  "Scans a git repository before it goes public and reports secrets, personal",
  "details, restricted terms and reachable old commits. It does not print a secret,",
  "any part of one, or a value from the private list.",
  "",
  "The only network use is a read-only `git ls-remote` against your configured",
  "remotes (skip it with --offline). The only file it writes is the template from",
  "--init-list.",
  "",
  "  path          repository to scan (default: the current directory)",
  "  --list <file> private list of personal and restricted patterns, kept outside the repo",
  "                (default: ~/.config/launch-guard/private-list.txt)",
  "  --offline     do not contact any remote (skips the hidden pull-request ref check)",
  "  --json        print the report as JSON (same fields, still no private data) instead of text",
  "  --init-list [file]",
  "                write a template private list (comment lines only) for you to fill in with",
  "                your own editor; refuses to overwrite a file or to write inside a git repo",
  "  --print-hook  print a git pre-push hook script to the screen; it writes nothing, you save it yourself",
  "  --help        show this text",
  "",
  "Exit codes: 0 no blocking findings, 1 at least one blocking finding, 2 usage or setup problem.",
  "",
].join("\n");

const HINT = "Usage: launch-guard [path] [--list <file>] [--offline] [--json] [--init-list [file]] [--print-hook] [--help]\n";
const FAIL_PATH = "launch-guard: the target path is not a readable directory.\n";
const FAIL_LIST = "launch-guard: the private list is missing, unreadable or invalid.\n";
const FAIL_ARGS = `launch-guard: unrecognised or incomplete arguments.\n${HINT}`;
const FAIL_RUN = "launch-guard: the scan could not be completed.\n";

const FAIL_EXISTS = "launch-guard: that file already exists, so it was left unchanged.\n";
const FAIL_IN_REPO = "launch-guard: the private list must live outside any git repository; choose another location.\n";
const FAIL_INIT = "launch-guard: the template could not be written.\n";

const TEMPLATE = [
  "# launch-guard private list. Keep this file outside every git repository.",
  "# Fill it in with your own editor. Do not paste its contents into a chat.",
  "# One entry per line, in this format:",
  "# format: kind|regex   (kind is personal or restricted)",
  "# Lines starting with # and blank lines are ignored.",
  "# Examples, delete the leading # and replace with your own terms:",
  "# personal|zq-example-name",
  "# personal|zq-example-street",
  "# restricted|zq-example-codeword",
  "",
].join("\n");

/** Printed by `--print-hook`. Fixed text: it holds no path and no value from the repository. */
const HOOK = [
  "#!/bin/sh",
  "# launch-guard pre-push hook. Save this as .git/hooks/pre-push and make it executable (chmod +x).",
  "# Replace the path with the place you keep launch-guard.mjs. Git runs hooks from the top of the repository.",
  "# Any non-zero result stops the push: 1 means a blocking finding, 2 means the tool could not run.",
  'node "/path/to/launch-guard.mjs" . --offline || exit 1',
  "",
].join("\n");

type Parsed =
  | { help: true }
  | { help: false; hook: true }
  | { help: false; hook: false; init: string | null | undefined; path: string; list: string | null; offline: boolean; json: boolean }
  | null;

function parseArgs(argv: string[]): Parsed {
  let path: string | null = null;
  let list: string | null = null;
  let init: string | null | undefined;
  let offline = false;
  let json = false;
  let hook = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") return { help: true };
    if (a === "--offline") {
      if (offline) return null;
      offline = true;
      continue;
    }
    if (a === "--json") {
      if (json) return null;
      json = true;
      continue;
    }
    if (a === "--print-hook") {
      if (hook) return null;
      hook = true;
      continue;
    }
    if (a === "--init-list") {
      if (init !== undefined) return null;
      const v = argv[i + 1];
      if (v !== undefined && !v.startsWith("-")) {
        init = v;
        i++;
      } else {
        init = null;
      }
      continue;
    }
    if (a === "--list") {
      const v = argv[++i];
      if (v === undefined || v === "" || list !== null) return null;
      list = v;
    } else if (a.startsWith("-") || path !== null) {
      return null;
    } else {
      path = a;
    }
  }
  if (hook) {
    // Printing the hook is a mode of its own, like --init-list: nothing else may be combined with it.
    return init !== undefined || path !== null || list !== null || offline || json ? null : { help: false, hook: true };
  }
  if (init !== undefined && (path !== null || list !== null || offline || json)) return null;
  return { help: false, hook: false, init, path: path ?? ".", list, offline, json };
}

/** True when `p` or any parent directory holds a `.git` entry. */
function insideGitRepo(p: string): boolean {
  let dir = dirname(resolve(p));
  for (;;) {
    if (existsSync(join(dir, ".git"))) return true;
    const up = dirname(dir);
    if (up === dir) return false;
    dir = up;
  }
}

function initList(target: string, io: Io): 0 | 2 {
  const file = resolve(target);
  if (existsSync(file)) {
    io.err(FAIL_EXISTS);
    return 2;
  }
  if (insideGitRepo(file)) {
    io.err(FAIL_IN_REPO);
    return 2;
  }
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, TEMPLATE, { flag: "wx" });
  } catch {
    io.err(FAIL_INIT);
    return 2;
  }
  // Under the home directory the `~` form is safe; elsewhere an absolute path could carry a user name, so give the file name only.
  const shown = displayPath(file, []);
  const where = shown.startsWith("~") ? shown : `${basename(file)} (in the folder you chose)`;
  io.out(
    [
      `Created a template private list at ${where}`,
      "Fill it in with your own editor, one pattern per line.",
      "Do not paste its contents into a chat, and do not ask an assistant to open it.",
      "Then run launch-guard again.",
      "",
    ].join("\n"),
  );
  return 0;
}

/** True when `root` is the top level of a git working tree (not a subfolder of one, not a plain folder). */
function isRepoRoot(root: string): boolean {
  try {
    const top = execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: root,
      encoding: "utf8",
      timeout: GIT_QUICK_TIMEOUT_MS,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (top === "") return false;
    const norm = (p: string): string => {
      const r = resolve(realpathSync.native(p));
      return process.platform === "win32" ? r.toLowerCase() : r;
    };
    return norm(top) === norm(root);
  } catch {
    return false;
  }
}

function isReadableDir(p: string): boolean {
  try {
    if (!statSync(p).isDirectory()) return false;
    readdirSync(p);
    return true;
  } catch {
    return false;
  }
}

function note(severity: Finding["severity"], label: Finding["label"], file = "list"): Finding {
  return { category: "basics", severity, file, line: null, label, entry: null };
}

/**
 * Never rejects and never exits 1 by accident: any failure, including a failing output stream, ends as exit 2.
 * The fixed failure message is best effort, since the stream that failed may be the one it is written to.
 */
export async function main(argv: string[], io: Io, scanners: Scanners = REAL): Promise<0 | 1 | 2> {
  try {
    return await run(argv, io, scanners);
  } catch {
    try {
      io.err(FAIL_RUN);
    } catch {
      // nothing more can be said; the exit code still reports the failure
    }
    return 2;
  }
}

async function run(argv: string[], io: Io, scanners: Scanners): Promise<0 | 1 | 2> {
  const args = parseArgs(argv);
  if (args === null) {
    io.err(FAIL_ARGS);
    return 2;
  }
  if (args.help) {
    io.out(USAGE);
    return 0;
  }
  if (args.hook) {
    io.out(HOOK);
    return 0;
  }
  if (args.init !== undefined) return initList(args.init ?? defaultDenyListPath(), io);
  const root = resolve(args.path);
  if (!isReadableDir(root)) {
    io.err(FAIL_PATH);
    return 2;
  }

  const findings: Finding[] = [];
  let entries: DenyEntry[] = [];
  let listFile: string | undefined;
  const explicit = args.list !== null;
  const file = explicit ? resolve(args.list as string) : defaultDenyListPath();
  if (explicit || existsSync(file)) {
    const loaded = loadDenyList(file);
    if (loaded.problem !== null) {
      io.err(FAIL_LIST);
      return 2;
    }
    entries = loaded.entries;
    listFile = file;
    if (entries.length === 0) findings.push(note("warn", "private list has no entries"));
  } else {
    findings.push(note("info", "checks skipped: no private list"));
  }

  const files = scanners.listFiles(root);
  findings.push(...scanners.secrets(root, entries, files));
  if (entries.length > 0) findings.push(...scanners.terms(root, entries, listFile, files));
  const isRoot = scanners.isRepoRoot?.(root) ?? true;
  if (isRoot) {
    findings.push(...scanners.history(root, entries));
    findings.push(...scanners.reachability(root, args.offline));
  } else {
    // History and reachability would run against a parent repository (or none), so they are skipped and the gap is shown.
    findings.push(note("warn", "not a repository root", "repository"));
  }
  findings.push(...scanners.basics(root, entries, files));

  const skipped = files.filter((f) => f.skipped !== undefined);
  for (const f of skipped.slice(0, MAX_SKIPPED_NOTES)) {
    findings.push({
      category: "basics",
      severity: "info",
      file: displayPath(f.path, entries),
      line: null,
      label: "file skipped",
      entry: null,
    });
  }
  if (skipped.length > MAX_SKIPPED_NOTES) findings.push(note("info", "more files skipped", "files"));

  const code = exitCode(findings);
  if (args.json) {
    io.out(renderJson(findings));
    return code;
  }
  io.out(renderReport(findings));
  io.out(`RESULT: ${code === 1 ? "FAIL" : "PASS"}\n`);
  return code;
}

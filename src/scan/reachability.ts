import { execFileSync } from "node:child_process";
import { GIT_HEAVY_TIMEOUT_MS, GIT_QUICK_TIMEOUT_MS, isTimeout } from "../gitTimeouts.js";
import type { Finding, Label, Severity } from "../types.js";

const MAX_BUFFER = 64 * 1024 * 1024;
const REMOTE_TIMEOUT_MS = 20_000;

function git(root: string, args: string[], env?: Record<string, string>, timeout: number = GIT_QUICK_TIMEOUT_MS): string {
  return execFileSync("git", ["-c", "core.quotePath=false", "-c", "core.fsmonitor=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: MAX_BUFFER,
    stdio: ["ignore", "pipe", "ignore"],
    ...(env ? { env: { ...process.env, ...env } } : {}),
    timeout,
  });
}

function finding(severity: Severity, file: string, label: Label): Finding {
  return { category: "reachability", severity, file, line: null, label, entry: null };
}

const lines = (text: string): string[] => text.split(/\r?\n/).filter((l) => l !== "");

/**
 * Environment for the read-only `ls-remote`: never prompt for anything. `sshCommand` is the user's own
 * `GIT_SSH_COMMAND` or global/system `core.sshCommand` (empty when neither is set) and `gitSsh` is the program named
 * by `GIT_SSH` (empty when unset). The user's setting is kept. `-o BatchMode=yes` (no password, passphrase or
 * host-key prompt) is added only to a plain `ssh`, recognised by program name whether bare, a full path or quoted,
 * because another program may not understand it. It goes before the user's own options: ssh keeps the first value
 * of an option, so a `-o BatchMode=no` of theirs cannot switch prompts back on. A program that still waits is
 * stopped by the timeout.
 */
export function remoteEnv(sshCommand: string, gitSsh: string): Record<string, string> {
  const env: Record<string, string> = { GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "" };
  const command = sshCommand.trim();
  if (command === "") {
    const program = gitSsh.trim();
    if (program === "") env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes";
    else if (program.includes('"')) env.GIT_SSH_COMMAND = "ssh -o BatchMode=yes"; // cannot be quoted safely: use the default
    else {
      // GIT_SSH ranks below core.sshCommand, so the repository's own setting would win unless the same program is
      // handed over as GIT_SSH_COMMAND, which ranks above every config file.
      env.GIT_SSH_COMMAND = isPlainSsh(program) ? `"${program}" -o BatchMode=yes` : `"${program}"`;
    }
    return env;
  }
  const { program, end } = splitProgram(command);
  env.GIT_SSH_COMMAND = isPlainSsh(program) ? `${command.slice(0, end)} -o BatchMode=yes${command.slice(end)}` : command;
  return env;
}

/** The first word of a command line (a quoted word may hold spaces) and where it ends. */
function splitProgram(command: string): { program: string; end: number } {
  const quote = command[0] === '"' || command[0] === "'" ? command[0] : "";
  if (quote !== "") {
    const close = command.indexOf(quote, 1);
    if (close > 0) return { program: command.slice(1, close), end: close + 1 };
  }
  const word = /^\S*/.exec(command)?.[0] ?? "";
  return { program: word, end: word.length };
}

/** True for `ssh` or `ssh.exe`, bare or as a path. */
function isPlainSsh(program: string): boolean {
  return /^ssh(?:\.exe)?$/i.test(program.split(/[\\/]/).pop() ?? "");
}

/**
 * The ssh command git would use here: `GIT_SSH_COMMAND`, else the user's global or system `core.sshCommand`; ""
 * when neither is set. The scanned repository's own config is deliberately not read: it may be someone else's
 * clone, and its `core.sshCommand` would be a program to run.
 */
function userSshCommand(root: string): string {
  const fromEnv = process.env.GIT_SSH_COMMAND;
  if (fromEnv !== undefined && fromEnv.trim() !== "") return fromEnv;
  for (const scope of ["--global", "--system"]) {
    try {
      // --includes follows `include` and `includeIf` (a per-folder identity is the usual way to hold several accounts).
      const value = git(root, ["config", scope, "--includes", "--get", "core.sshCommand"]).trim();
      if (value !== "") return value;
    } catch {
      // not set in this scope
    }
  }
  return "";
}

/**
 * Looks for old commits that may still be reachable after a rewrite: refs/original (block), unreachable-but-present
 * commits and blobs (warn only: staging, amend, rebase and stash leave them in the object store, and a push does
 * not publish them; re-staged blobs and dropped stashes clear with `git gc --prune=now`, while commits that only the
 * reflog still holds after an amend or rebase need `git reflog expire --expire-unreachable=now --all` first),
 * stash and extra tag/branch refs (local), and hidden pull-request refs on each remote
 * (read-only `git ls-remote --refs`, never prompting). Findings carry only fixed words and `ref #n`,
 * `object #n` or `remote ref #n`: never ref names, remote names or URLs, object ids or error text. Git is run
 * with argument arrays only (no shell). A rewrite alone is not enough when any block finding appears.
 */
export function checkReachability(root: string, options: { offline?: boolean } = {}): Finding[] {
  const out: Finding[] = [];

  let refs: string[];
  let current: string | null;
  let currentUnknown = false;
  try {
    refs = lines(git(root, ["for-each-ref", "--format=%(refname)"]));
  } catch {
    return [finding("info", "reachability", "history incomplete")];
  }
  try {
    current = git(root, ["symbolic-ref", "-q", "HEAD"]).trim() || null;
  } catch (err) {
    current = null;
    // A timeout means the branch is unknown, not that HEAD is detached: say so instead of flagging it as an extra ref.
    if (isTimeout(err)) currentUnknown = true;
  }
  if (currentUnknown) out.push(finding("info", "reachability", "history incomplete"));
  refs.forEach((ref, i) => {
    const file = `ref #${i + 1}`;
    if (ref.startsWith("refs/original/")) {
      out.push(finding("block", file, "recommend a fresh repository"));
    } else if (ref === "refs/stash") {
      out.push(finding("warn", file, "extra ref"));
    } else if (ref.startsWith("refs/heads/") && currentUnknown) {
      // The checked-out branch cannot be told apart from the others; flagging it would be a false alarm.
    } else if ((ref.startsWith("refs/tags/") || ref.startsWith("refs/heads/")) && ref !== current) {
      out.push(finding("warn", file, "extra ref"));
    }
  });

  try {
    const fsck = lines(git(root, ["fsck", "--unreachable", "--no-reflogs", "--no-progress"], undefined, GIT_HEAVY_TIMEOUT_MS));
    let n = 0;
    for (const line of fsck) {
      const type = line.split(" ")[1];
      if (line.startsWith("unreachable ") && (type === "commit" || type === "blob")) n++;
    }
    // One line however many there are: a busy repo has hundreds, and each one says the same thing.
    if (n > 0) out.push(finding("warn", `${n} object${n === 1 ? "" : "s"}`, "unreachable object"));
  } catch {
    out.push(finding("info", "reachability", "history incomplete"));
  }

  let remotes: string[];
  try {
    remotes = lines(git(root, ["remote"]));
  } catch {
    // A timeout or any other failure: not knowing the remotes is not the same as having none.
    out.push(finding("info", "remote", "remote not checked"));
    return out;
  }
  if (remotes.length === 0) {
    out.push(finding("info", "remote", "no remote"));
    return out;
  }
  if (options.offline) {
    out.push(finding("info", "remote", "remote not checked"));
    return out;
  }

  const env = remoteEnv(userSshCommand(root), process.env.GIT_SSH ?? "");
  let unchecked = false;
  let n = 0;
  for (const remote of remotes) {
    try {
      const listing = git(
        root,
        ["-c", "credential.helper=", "-c", "protocol.ext.allow=never", "ls-remote", "--refs", "--", remote],
        env,
        REMOTE_TIMEOUT_MS,
      );
      for (const l of lines(listing)) {
        const ref = l.split("\t")[1] ?? "";
        if (ref.startsWith("refs/pull/") || ref.startsWith("refs/merge-requests/")) {
          out.push(finding("block", `remote ref #${++n}`, "recommend a fresh repository"));
        }
      }
    } catch {
      unchecked = true;
    }
  }
  if (unchecked) out.push(finding("info", "remote", "remote not checked"));
  return out;
}

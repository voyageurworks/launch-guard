import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { downgrade, isAllowed } from "../allow.js";
import { GIT_HEAVY_TIMEOUT_MS, GIT_QUICK_TIMEOUT_MS, isTimeout } from "../gitTimeouts.js";
import { cleanText, displayPath } from "../denylist.js";
import type { DenyEntry } from "../denylist.js";
import type { Finding, Label } from "../types.js";
import { StatementTracker } from "./secrets.js";
import { matchingEntries } from "./terms.js";

/** Commits read per `git log` call, so no single call returns an unbounded amount of text. */
const BATCH = 100;
const MAX_BUFFER = 256 * 1024 * 1024;

const SEP = "\u0000";
const FULL_SHA = /^[0-9a-f]{40,64}$/;
const SHORT_SHA = /^[0-9a-f]{4,64}$/;

export interface HistoryOptions {
  /** Largest output (bytes) accepted from one git call. Default 256 MB; lower it to test the overflow path. */
  maxBuffer?: number;
  /** Commits per `git log` call. Default 100. */
  batch?: number;
}

function git(root: string, args: string[], maxBuffer: number, timeout = GIT_QUICK_TIMEOUT_MS): string {
  return execFileSync("git", ["-c", "core.quotePath=false", "-c", "log.showSignature=false", "-c", "core.fsmonitor=false", ...args], {
    cwd: root,
    encoding: "utf8",
    maxBuffer,
    timeout,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** True when this git can show a merge commit's own changes (`git log --remerge-diff`, added in 2.36). */
function supportsRemerge(root: string): boolean {
  try {
    const m = /(\d+)\.(\d+)/.exec(git(root, ["version"], 1024 * 1024));
    return m !== null && (Number(m[1]) > 2 || (Number(m[1]) === 2 && Number(m[2]) >= 36));
  } catch {
    return false;
  }
}

/** A repo-level finding with no path: the file column holds a fixed word. */
function note(severity: "info", label: Label): Finding {
  return { category: "history", severity, file: "history", line: null, label, entry: null };
}

function hit(file: string, label: Label, entry: number | null, line: number | null, path?: string): Finding {
  return {
    category: "history",
    severity: path === undefined ? "block" : downgrade(path, "block"),
    file,
    line,
    label,
    entry,
  };
}

/** Path from the `+++ ` header of a diff (prefixes are pinned to a/ and b/); null for a deletion. */
function newPath(header: string): string | null {
  let p = header.replace(/\t.*$/, "");
  if (p === "/dev/null") return null;
  if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
  return p.startsWith("b/") ? p.slice(2) : p;
}

/** Findings for the text of one commit message (lines against secret rules, the whole text against the list). */
function scanText(text: string, where: string, entries: DenyEntry[], out: Finding[]): void {
  const tracker = new StatementTracker();
  if (text.split(/\r?\n/).map((l) => tracker.classify(l)).some((label) => label !== null)) {
    out.push(hit(where, "secret in history", null, null));
  }
  for (const e of matchingEntries(text, entries)) out.push(hit(where, "term in history", e.entry, null));
}

const RAW_LINE = /^:\d{6} \d{6} [0-9a-f]+\.* [0-9a-f]+\.* ([A-Z])\d*\t(.*)$/;

/** Scans one commit's raw name list and patch: every touched path against the list, added lines for secrets and terms. */
function scanPatch(sha: string, patch: string[], entries: DenyEntry[], out: Finding[]): void {
  let path: string | null = null;
  let oldLeft = 0;
  let newLeft = 0;
  let lineNo = 0;
  let previous = "";
  let tracker = new StatementTracker();
  for (const raw of patch) {
    if (oldLeft > 0 || newLeft > 0) {
      const kind = raw[0];
      const text = raw.slice(1);
      if (kind === "+") {
        newLeft--;
        const n = lineNo++;
        const label = tracker.classify(text); // every added line goes in, so a statement is followed across it
        if (path !== null && !isAllowed(text, previous)) {
          if (label !== null) {
            out.push(hit(`${sha}:${displayPath(path, entries)}`, "secret in history", null, n, path));
          }
          for (const e of matchingEntries(text, entries)) {
            out.push(hit(`${sha}:${displayPath(path, entries)}`, "term in history", e.entry, n));
          }
        }
      } else if (kind === "-") {
        oldLeft--;
      } else if (kind === " ") {
        oldLeft--;
        newLeft--;
        lineNo++;
        tracker.classify(text); // unchanged context: keeps a statement whole, its own findings belong to older commits
      }
      if (kind !== "\\") previous = text;
      continue;
    }
    const rawLine = RAW_LINE.exec(raw);
    if (rawLine) {
      // Name-only information: present for renames, empty files, mode changes and binaries, which have no +++ line.
      if (rawLine[1] !== "D") {
        let p = rawLine[2].split("\t").pop() ?? "";
        if (p.startsWith('"') && p.endsWith('"')) p = p.slice(1, -1);
        for (const e of matchingEntries(cleanText(p), entries)) {
          out.push(hit(`${sha}:${displayPath(p, entries)}`, "path matches list", e.entry, null));
        }
      }
    } else if (raw.startsWith("diff --git ")) {
      path = null;
    } else if (raw.startsWith("+++ ")) {
      path = newPath(raw.slice(4));
    } else {
      const m = /^@@ -\d+(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(raw);
      if (m) {
        oldLeft = m[1] === undefined ? 1 : Number(m[1]);
        newLeft = m[3] === undefined ? 1 : Number(m[3]);
        lineNo = Number(m[2]);
        previous = "";
        tracker = new StatementTracker();
      }
    }
  }
}

/**
 * Scans every commit reachable from any ref or the reflog: touched paths, added lines of each patch, commit
 * messages, author and committer names and emails, ref names and reflog subjects. A finding holds the short commit
 * id and path (or the words message/author, `ref #n`, `reflog #n`), never author, email, message, ref name or
 * matched text. Git is run with argument arrays only (no shell); errors become a fixed info finding, never the
 * error text. Record markers carry a per-run random nonce so file text cannot forge them.
 */
export function scanHistory(root: string, entries: DenyEntry[], options: HistoryOptions = {}): Finding[] {
  const maxBuffer = options.maxBuffer ?? MAX_BUFFER;
  const batchSize = Math.max(1, options.batch ?? BATCH);
  let shallow: boolean;
  let shas: string[];
  try {
    shallow = git(root, ["rev-parse", "--is-shallow-repository"], maxBuffer).trim() === "true";
    shas = git(root, ["rev-list", "--all", "--reflog"], maxBuffer).split(/\r?\n/).filter((s) => s !== "");
  } catch {
    return [note("info", "history incomplete")];
  }
  if (shas.some((s) => !FULL_SHA.test(s))) return [note("info", "history incomplete")];
  if (shas.length === 0) return [note("info", "no commits")];

  const out: Finding[] = [];
  let incomplete = shallow;

  try {
    const refs = git(root, ["for-each-ref", "--format=%(refname)"], maxBuffer).split(/\r?\n/).filter((r) => r !== "");
    refs.forEach((ref, i) => {
      for (const e of matchingEntries(ref, entries)) out.push(hit(`ref #${i + 1}`, "term in history", e.entry, null));
    });
  } catch {
    incomplete = true;
  }

  try {
    const subjects = git(root, ["reflog", "show", "--all", "--format=%gs"], maxBuffer).split(/\r?\n/).filter((s) => s !== "");
    subjects.forEach((subject, i) => {
      for (const e of matchingEntries(subject, entries)) out.push(hit(`reflog #${i + 1}`, "term in history", e.entry, null));
    });
  } catch {
    incomplete = true;
  }

  const nonce = randomBytes(16).toString("hex");
  const START = `@@START-${nonce}@@`;
  const END = `@@END-${nonce}@@`;

  // A plain patch of a merge commit is empty, so a secret added only while resolving a conflict would be missed.
  // `--remerge-diff` (git 2.36+) shows exactly what the merge changed beyond an automatic merge.
  const remerge = supportsRemerge(root);
  if (!remerge) incomplete = true;
  const args = (list: string[]): string[] => [
    // Pinned so the user's own git config cannot change what is parsed (no root-commit diff, blank-line trimming, fewer context lines).
    "-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "-c", "diff.suppressBlankEmpty=false",
    "log", "--no-walk", "--root", "-U3", "-p", "--raw", "--no-color", "--no-ext-diff", "--no-textconv",
    ...(remerge ? ["--remerge-diff"] : []),
    "--src-prefix=a/", "--dst-prefix=b/",
    `--format=${START}%h%x00%an%x00%ae%x00%cn%x00%ce%x00%B${END}`,
    ...list,
  ];

  // Annotated tags carry their own message and tagger, which no commit scan reads.
  try {
    const tags = git(
      root,
      ["for-each-ref", "refs/tags", `--format=${START}%(objecttype)%00%(taggername)%00%(taggeremail)%00%(contents)${END}`],
      maxBuffer,
    );
    tags.split(START).slice(1).forEach((record, i) => {
      const endAt = record.indexOf(END);
      if (endAt < 0) {
        incomplete = true;
        return;
      }
      const [kind, name, email, ...rest] = record.slice(0, endAt).split(SEP);
      if (kind !== "tag") return;
      const where = `tag #${i + 1}`;
      const tagger = new Set<number>();
      for (const field of [name ?? "", email ?? ""]) for (const e of matchingEntries(field, entries)) tagger.add(e.entry);
      for (const entry of [...tagger].sort((a, b) => a - b)) out.push(hit(where, "term in history", entry, null));
      scanText(rest.join(SEP), where, entries, out);
    });
  } catch {
    incomplete = true;
  }

  let timedOut = false;
  /** Reads and scans these commits; returns the number of commits that could not be used (0 when all were). */
  const scanBatch = (list: string[]): number => {
    let text: string;
    try {
      text = git(root, args(list), maxBuffer, GIT_HEAVY_TIMEOUT_MS);
    } catch (err) {
      if (isTimeout(err)) timedOut = true;
      return -1;
    }
    let bad = 0;
    let seen = 0;
    for (const record of text.split(START).slice(1)) {
      seen++;
      const endAt = record.indexOf(END);
      const header = endAt < 0 ? [] : record.slice(0, endAt).split(SEP);
      if (endAt < 0 || header.length < 6 || !SHORT_SHA.test(header[0])) {
        bad++;
        continue;
      }
      const [sha, an, ae, cn, ce, ...rest] = header;
      const authorEntries = new Set<number>();
      for (const field of [an, ae, cn, ce]) for (const e of matchingEntries(field, entries)) authorEntries.add(e.entry);
      for (const entry of [...authorEntries].sort((a, b) => a - b)) out.push(hit(`${sha}:author`, "term in history", entry, null));
      scanText(rest.join(SEP), `${sha}:message`, entries, out);
      scanPatch(sha, record.slice(endAt + END.length).split(/\r?\n/), entries, out);
    }
    return bad + Math.max(0, list.length - seen);
  };

  for (let at = 0; at < shas.length; at += batchSize) {
    const slice = shas.slice(at, at + batchSize);
    const result = scanBatch(slice);
    if (result === 0) continue;
    if (timedOut) {
      // git is not answering: retrying commit by commit would only multiply the wait.
      incomplete = true;
      break;
    }
    if (slice.length === 1) {
      incomplete = true;
      continue;
    }
    // The batch failed or was malformed: its findings so far may be partial, so redo it one commit at a time.
    // (A malformed batch is rare; duplicates are removed below.)
    for (const sha of slice) {
      if (scanBatch([sha]) !== 0) incomplete = true;
      if (timedOut) break;
    }
    if (timedOut) break;
  }

  const seenKeys = new Set<string>();
  const unique = out.filter((f) => {
    const key = `${f.file}|${f.line}|${f.label}|${f.entry}`;
    if (seenKeys.has(key)) return false;
    seenKeys.add(key);
    return true;
  });
  if (incomplete) unique.unshift(note("info", "history incomplete"));
  return unique;
}

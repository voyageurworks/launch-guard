import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface DenyEntry {
  kind: "personal" | "restricted";
  pattern: RegExp;
  /** 1-based line number in the private list. */
  entry: number;
}

/** Outside any repo: under the user's home config. */
export function defaultDenyListPath(): string {
  return join(homedir(), ".config", "launch-guard", "private-list.txt");
}

/**
 * One entry per line, `kind|regex` (kind is personal or restricted); `#` lines and blank lines are ignored.
 * Problems are fixed strings: they name an entry number, never any text from the file.
 */
export function loadDenyList(file: string): { entries: DenyEntry[]; problem: string | null } {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch (err) {
    const missing = (err as NodeJS.ErrnoException)?.code === "ENOENT";
    return { entries: [], problem: missing ? "private list not found" : "private list unreadable" };
  }
  const entries: DenyEntry[] = [];
  const invalid: number[] = [];
  raw
    .replace(/^﻿/, "")
    .normalize("NFC")
    .split(/\r?\n/)
    .forEach((line, i) => {
      const entry = i + 1;
      if (line.trim() === "" || line.startsWith("#")) return;
      const sep = line.indexOf("|");
      const kind = sep < 0 ? "" : line.slice(0, sep).trim();
      const source = sep < 0 ? "" : line.slice(sep + 1);
      if ((kind !== "personal" && kind !== "restricted") || source === "") {
        invalid.push(entry);
        return;
      }
      try {
        const pattern = new RegExp(source, "iu");
        if (pattern.test("")) invalid.push(entry); // would match everywhere
        else entries.push({ kind, pattern, entry });
      } catch {
        invalid.push(entry);
      }
    });
  const problem = invalid.length ? invalid.map((n) => `entry ${n} invalid`).join("; ") : null;
  return { entries, problem };
}

// ANSI escape sequences (CSI and OSC), then control, bidi and zero-width characters.
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)|\u001b./g;
const CONTROL = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g;

/** Text safe to print and to match against: normalized, with escapes and control characters removed. */
export function cleanText(text: string): string {
  return text.replace(ANSI, "").replace(CONTROL, "").normalize("NFC");
}

export function stripHome(p: string): string {
  const home = homedir().replace(/\\/g, "/").replace(/\/+$/, "");
  if (!home) return p;
  const n = p.replace(/\\/g, "/");
  const same = (a: string, b: string) => (process.platform === "win32" ? a.toLowerCase() === b.toLowerCase() : a === b);
  if (n.length >= home.length && same(n.slice(0, home.length), home) && (n.length === home.length || n[home.length] === "/")) {
    return "~" + n.slice(home.length);
  }
  return n;
}

/** A path safe to print: no control characters, home directory as `~`, list matches as `[redacted]`. */
export function displayPath(p: string, entries: DenyEntry[]): string {
  const text = stripHome(cleanText(p));
  const spans: [number, number][] = [];
  for (const e of entries) {
    for (const m of text.matchAll(new RegExp(e.pattern.source, "giu"))) {
      if (m[0] !== "") spans.push([m.index, m.index + m[0].length]);
    }
  }
  spans.sort((a, b) => a[0] - b[0]);
  let out = "";
  let at = 0;
  for (const [start, end] of spans) {
    if (end <= at) continue;
    out += text.slice(at, Math.max(start, at)) + "[redacted]";
    at = end;
  }
  return out + text.slice(at);
}

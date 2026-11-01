import { readFileSync } from "node:fs";
import { join } from "node:path";
import { downgrade, isAllowed } from "../allow.js";
import { displayPath } from "../denylist.js";
import type { DenyEntry } from "../denylist.js";
import { isEnvFile, listRepoFiles } from "../files.js";
import type { RepoFile } from "../files.js";
import type { Finding, Label } from "../types.js";

/**
 * Shannon entropy (bits per character) above which a value next to a key/token/password word counts as a
 * secret. Random base62 text scores about 5.2 and random hex about 4.0 at 20+ characters; identifiers and
 * prose score below 3.5. Raise it to cut false positives, lower it to catch weaker secrets.
 */
export const ENTROPY_THRESHOLD = 3.5;

/** Shortest quoted or assigned value the entropy rule looks at. */
export const MIN_VALUE_LENGTH = 20;


const KNOWN_FORMATS: RegExp[] = [
  /\bAKIA[0-9A-Z]{16}\b/, // AWS access key id
  /\b(?:gh[pos]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,})/, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
  /\bsk_live_[A-Za-z0-9]{10,}/, // Stripe live keys
  /\bAIza[0-9A-Za-z_-]{35}/, // Google API keys
  /\bnpm_[A-Za-z0-9]{36}\b/, // npm tokens
  /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/, // private key blocks
  /-{5}BEGIN PGP PRIVATE KEY BLOCK-{5}/, // PGP private key blocks (written with a quantifier so this file does not match its own rule)
  /(?<![A-Za-z0-9_-])eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/, // JWT-shaped strings (the lookbehind keeps a run of "eyJ-" from backtracking quadratically)
  /(?<![A-Za-z0-9_])sk-ant-[A-Za-z0-9_-]{20,}/, // Anthropic keys
  /(?<![A-Za-z0-9_])sk-proj-[A-Za-z0-9_-]{20,}/, // OpenAI project keys
  /(?<![A-Za-z0-9_])sk-(?=[A-Za-z]*\d)[A-Za-z0-9]{32,}/, // OpenAI legacy keys (must hold a digit)
  /\bhf_[A-Za-z0-9]{30,}/, // Hugging Face tokens
  /\bglpat-[A-Za-z0-9_-]{20,}/, // GitLab personal access tokens
  /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}/, // SendGrid keys
  /\brk_live_[A-Za-z0-9]{16,}/, // Stripe restricted keys
  /\bwhsec_[A-Za-z0-9]{20,}/, // Stripe webhook signing secrets
  /hooks\.slack\.com\/services\/T[A-Z0-9]{6,}\/B[A-Z0-9]{6,}\/[A-Za-z0-9]{20,}/, // Slack incoming-webhook URLs
  /\bSK[0-9a-f]{32}\b/, // Twilio API key secrets
  /\bkey-[0-9a-f]{32}\b/, // Mailgun keys
  /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/, // Telegram bot tokens
  /\b[MN][A-Za-z0-9_-]{23,25}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,38}\b/, // Discord bot tokens
  /\bya29\.[A-Za-z0-9_-]{20,}/, // Google OAuth access tokens
  /\bdop_v1_[a-f0-9]{64}\b/, // DigitalOcean tokens
  /\bshp(?:at|ca|pa|ss)_[a-f0-9]{32}\b/, // Shopify tokens
  /\bAccountKey=[A-Za-z0-9+/]{40,}={0,2}/, // Azure storage connection strings
];

/** `Authorization: Bearer <token>` or `Basic <base64>`; group 1 is the credential. Judged like a keyword value. */
const AUTH_HEADER = /\b(?:bearer|basic)\s+([A-Za-z0-9._~+/=-]{24,})/gi;
/** The credential from the RFC 7617 example, which documentation quotes everywhere. */
const RFC_BASIC_SAMPLE = "QWxhZGRpbjpvcGVuIHNlc2FtZQ==";

/** `scheme://user:password@host`; group 1 is the user, group 2 the password. Starts only at a scheme's first letter. */
const URL_CREDENTIALS = /(?<![A-Za-z0-9+.-])[A-Za-z][A-Za-z0-9+.-]*:\/\/([^\s:/@]+):([^\s@/]{4,})@/g;
const URL_PLACEHOLDER_WORDS = new Set([
  "password", "pass", "passwd", "pwd", "user", "username", "secret", "token", "example", "sample", "demo", "test",
  "testing", "foobar", "hunter2", "mypassword", "mysecret", "mytoken", "abc123", "password1", "letmein", "qwerty",
  "changeme", "redacted", "hidden", "masked", "dummy",
]);
/** A URL password is only reported when it looks like a real token: long enough and random enough. */
const URL_MIN_PASSWORD = 12;
const URL_MIN_ENTROPY = 3.0;
const ENV_REFERENCE = /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/;

/** Words that make a nearby value suspect. */
const KEYWORDS = "key|token|password|secret|passwd|credential|passphrase|(?<![A-Za-z])pwd";
/**
 * What may sit between a keyword and its `=` or `:`, and around it. Every repeat is bounded: an unbounded one makes
 * the pattern quadratic on a long minified line of repeated keywords or spaces (seconds to minutes per line).
 */
const AFTER_KEYWORD = "[\\w.-]{0,40}";
const GAP = "\\s{0,200}";

const NEAR_KEYWORD = new RegExp(
  `(?:${KEYWORDS})${AFTER_KEYWORD}["']?${GAP}[:=]${GAP}["']?([A-Za-z0-9+/_.=-]{${MIN_VALUE_LENGTH},})`,
  "gi",
);

const PLACEHOLDER = /x{4,}|0{4,}|changeme|your[-_ ]?(?:key|token|secret|password)|example|dummy|process\.env|\$\{|<[^<>]*>/i;

function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}

/** True when the line holds a URL with an embedded, non-placeholder password. Returns no matched text. */
function hasUrlCredentials(line: string): boolean {
  for (const m of line.matchAll(URL_CREDENTIALS)) {
    const original = m[2]!;
    const password = original.toLowerCase();
    if (original.length < URL_MIN_PASSWORD || ENV_REFERENCE.test(original)) continue;
    if (password === m[1]!.toLowerCase() || /^(.)\1*$/.test(password) || /^[*.#_-]+$/.test(password)) continue;
    if (URL_PLACEHOLDER_WORDS.has(password) || password.split(/[^a-z0-9]+/).some((w) => URL_PLACEHOLDER_WORDS.has(w))) continue;
    if (PLACEHOLDER.test(password) || entropy(original) < URL_MIN_ENTROPY) continue;
    return true;
  }
  return false;
}

/** Same keyword, but a quoted value may hold symbols (`!@#$%^&*` and so on) that the unquoted form stops at. */
const NEAR_KEYWORD_QUOTED = new RegExp(
  `(?:${KEYWORDS})${AFTER_KEYWORD}["']?${GAP}[:=]${GAP}["']([^"'\\s]{${MIN_VALUE_LENGTH},})["']`,
  "gi",
);

function looksLikeSecretValue(value: string | undefined): boolean {
  if (!value || PLACEHOLDER.test(value)) return false;
  if (value.endsWith("...") || value === RFC_BASIC_SAMPLE) return false; // a truncated example, not a credential
  if (!/\d/.test(value) || !/[A-Za-z]/.test(value)) return false;
  return entropy(value) > ENTROPY_THRESHOLD;
}

/**
 * True when a keyword rule (unquoted, quoted with symbols, or an auth header) finds a secret-looking value anywhere
 * in the text. Every match is judged, so a harmless first one (`"publicKey":"example"`) cannot hide a real second one
 * on the same minified line.
 */
function keywordValueIsSecret(text: string): boolean {
  for (const re of [NEAR_KEYWORD, NEAR_KEYWORD_QUOTED, AUTH_HEADER]) {
    for (const m of text.matchAll(re)) if (looksLikeSecretValue(m[1])) return true;
  }
  return false;
}

/**
 * Label for the first rule this line trips, or null. Never returns or stores any matched text. A value that sits
 * on a later line than its key is handled by `StatementTracker`, which wraps this.
 */
export function classifyLine(line: string): Label | null {
  if (KNOWN_FORMATS.some((re) => re.test(line)) || hasUrlCredentials(line)) return "secret format";
  return keywordValueIsSecret(line) ? "secret near keyword" : null;
}

/** A key with its value still to come: ends at the separator, a YAML block marker, a line continuation or an opening quote. */
const KEY_WITHOUT_VALUE = new RegExp(`(?:${KEYWORDS})${AFTER_KEYWORD}["']?${GAP}[:=]${GAP}(?:[>|][+-]?|\\\\|["'])?$`, "i");
const KEYWORD_ASSIGNMENT = new RegExp(`(?:${KEYWORDS})${AFTER_KEYWORD}["']?${GAP}[:=]`, "i");
/** A line that adds no text of its own: blank, or only a block marker, a quote, a continuation or a plus. Tested on the trimmed line. */
const FILLER = /^(?:[>|][+-]?|\\|["']|\+|,)?$/;
/** Filler, or a whole-line comment (`# note`, `// note`) sitting between a key and its value. */
const isFiller = (line: string): boolean => {
  const t = line.trim();
  return FILLER.test(t) || t.startsWith("#") || t.startsWith("//");
};
/** A trailing block marker, quote or continuation; the whitespace before it is removed with `trimEnd` after. */
const VALUE_INDICATOR = /(?:[>|][+-]?|\\|["'])$/;
/** A string split with `+` or a backslash continues on the next line. Group 2 is the whitespace before the sign, group 3 the sign. */
const WRAP_END = /(["']?)(\s{0,20})(\+|\\)$/;
/**
 * Whether a line is one bare value that can continue a statement: a single token (optionally quoted, with a
 * trailing comma, semicolon, plus or backslash, and an optional trailing `# comment`). A line with a space inside,
 * ending in a colon, or holding `NAME=value` is a key, a sentence or other code, not a value. Linear time.
 */
function isValueTokenLine(line: string): boolean {
  let t = line.trim();
  for (const marker of [" #", " //"]) {
    const at = t.indexOf(marker);
    if (at >= 0) t = t.slice(0, at).trimEnd();
  }
  if (/[,;+\\]$/.test(t)) t = t.slice(0, -1).trimEnd();
  if (t.startsWith("+")) t = t.slice(1).trimStart();
  const quoted = /^["']/.test(t);
  if (quoted) t = t.slice(1);
  if (/["']$/.test(t)) t = t.slice(0, -1);
  if (t === "" || /[\s"']/.test(t) || t.endsWith(":")) return false;
  // An unquoted `OPENAI_MODEL=gpt-4o` is another assignment (base64 only has `=` at the end); a quoted value may hold one.
  return quoted || !/=[^=]/.test(t);
}
/** Most lines one statement is followed across. */
const MAX_STATEMENT_LINES = 4;

/**
 * Joins up to four consecutive lines into one statement when a keyword assignment is left open, so a secret split
 * over several lines is judged as a whole: a YAML block (`key: >-` then the value), a backslash continuation, a
 * value that follows its key on the next line, or a string built with `+`. Feed it every line of one file (or one
 * diff hunk) in order. It returns the same fixed labels as `classifyLine` and keeps no matched text in any output.
 */
export class StatementTracker {
  private pending = "";
  private lines = 0;
  /** The last complete keyword assignment, kept so a following line that starts with `+` can extend it (Java style). */
  private last = "";
  private lastLines = 0;

  classify(line: string): Label | null {
    let label = classifyLine(line);
    if (this.pending === "" && this.last !== "" && line.trim().startsWith("+") && isValueTokenLine(line) && this.lastLines < MAX_STATEMENT_LINES) {
      const joined = this.last.replace(/["'];?\s*$/, "") + line.trim().replace(/^\+\s*/, "").replace(/^["']/, "");
      if (!label && keywordValueIsSecret(joined)) label = "secret near keyword";
      this.last = joined;
      this.lastLines++;
      return label;
    }
    if (this.pending !== "" && !isFiller(line) && isValueTokenLine(line)) {
      if (!label && keywordValueIsSecret(this.join(line))) label = "secret near keyword";
    }
    this.advance(line);
    return label;
  }

  private join(line: string): string {
    const above = this.pending.trimEnd();
    const next = line.trim().replace(/^\+\s*/, "");
    const wrap = WRAP_END.exec(above);
    if (wrap) {
      // `abc\` continues the string directly; `'abc' \` (a space before a backslash) is a new shell argument.
      const gap = wrap[3] === "\\" && wrap[2] !== "" ? " " : "";
      return above.slice(0, wrap.index).trimEnd() + gap + next.replace(/^["']/, "");
    }
    // After a bare key the value keeps its own quotes, so a quoted value with symbols or a colon is read whole.
    return `${above.replace(VALUE_INDICATOR, "").trimEnd()} ${next}`;
  }

  private advance(line: string): void {
    if (isFiller(line)) {
      // Adds no text, but still counts: a value many blank or comment lines below its key is not followed.
      if (this.pending !== "" && ++this.lines >= MAX_STATEMENT_LINES) {
        this.pending = "";
        this.lines = 0;
      }
      return;
    }
    // A line that is not a bare token ends the statement: it starts fresh (it may open a new one itself).
    const text = this.pending !== "" && isValueTokenLine(line) ? this.join(line) : line;
    const open = KEY_WITHOUT_VALUE.test(text.trimEnd()) || (WRAP_END.test(text.trimEnd()) && KEYWORD_ASSIGNMENT.test(text));
    // A finished keyword assignment may still be extended by a next line that starts with `+`.
    this.last = !open && KEYWORD_ASSIGNMENT.test(text) ? text : "";
    this.lastLines = 1;
    if (open && this.lines + 1 < MAX_STATEMENT_LINES) {
      this.pending = text;
      this.lines++;
    } else {
      this.pending = "";
      this.lines = 0;
    }
  }
}

/**
 * Scans file contents for known key formats and high-entropy values next to secret-like words. Tracked `.env*`
 * files are flagged by name and never opened. A finding holds the path, line and a fixed label, never any part
 * of the secret.
 */
export function scanSecrets(root: string, entries: DenyEntry[] = [], listing?: RepoFile[]): Finding[] {
  const findings: Finding[] = [];
  for (const f of listing ?? listRepoFiles(root, isEnvFile)) {
    const shown = displayPath(f.path, entries);
    if (isEnvFile(f.path)) {
      findings.push({
        category: "secret",
        severity: downgrade(f.path, "block"),
        file: shown,
        line: null,
        label: "tracked env file",
        entry: null,
      });
      continue;
    }
    if (f.skipped) continue;

    let text: string;
    try {
      text = readFileSync(join(root, f.path), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const tracker = new StatementTracker();
    lines.forEach((line, i) => {
      const previous = i > 0 ? lines[i - 1] : "";
      const label = tracker.classify(line); // every line goes in, allowed or not, so a statement is followed across it
      if (isAllowed(line, previous) || !label) return;
      findings.push({
        category: "secret",
        severity: downgrade(f.path, "block"),
        file: shown,
        line: i + 1,
        label,
        entry: null,
      });
    });
  }
  return findings;
}

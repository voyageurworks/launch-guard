import type { Severity } from "./types.js";

const ALLOW = /launch-guard-allow:\s*\S/;
const FIXTURE_DIRS = new Set(["test", "tests", "fixtures", "__tests__", "__fixtures__", "__mocks__", "testdata", "spec", "specs"]);
// note.test.ts, a.spec.js, foo_test.go, test_foo.py: whole-name patterns, never a bare substring.
const TEST_FILE = /(?:\.(?:test|spec)\.[^.]+|_test\.[^.]+|^test_.+)$/;
// Key and credential containers are never lowered, whatever folder or test-looking name they have.
const SENSITIVE_EXT = new Set(["pem", "key", "p12", "pfx", "env", "crt", "cer", "jks", "keystore", "asc", "gpg", "ppk", "kdbx"]);

const COMMENT_ONLY = /^\s*(\/\/|#|\/\*|<!--|\*)/;

/** True when the line, or a comment-only line right before it, carries `launch-guard-allow: <reason>` with a non-empty reason. */
export function isAllowed(line: string, previousLine: string): boolean {
  return ALLOW.test(line) || (COMMENT_ONLY.test(previousLine) && ALLOW.test(previousLine));
}

/**
 * Lowers block to warn for a secret or user-profile-path finding in a test file or under a test, fixture or
 * example path. Callers use it for those two kinds only: list matches (personal, restricted, path, history) stay
 * block. A file with a sensitive extension (pem, key, p12, ...) or a name starting `.env` is never lowered.
 */
export function downgrade(file: string, severity: Severity): Severity {
  if (severity !== "block") return severity;
  const parts = file.toLowerCase().split(/[\\/]+/);
  const name = parts[parts.length - 1] ?? "";
  const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : "";
  if (name.startsWith(".env") || SENSITIVE_EXT.has(ext)) return severity;
  const isTestFile = TEST_FILE.test(name);
  const inFixtureDir = parts.slice(0, -1).some((p) => FIXTURE_DIRS.has(p));
  const inExamples = parts.some((p, i) => p === "docs" && parts[i + 1] === "examples");
  return inFixtureDir || inExamples || isTestFile ? "warn" : severity;
}

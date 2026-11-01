import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultDenyListPath, displayPath, loadDenyList } from "./denylist.js";

let dir = "";
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = "";
});

function listWith(text: string): string {
  dir = mkdtempSync(join(tmpdir(), "lg-deny-"));
  const file = join(dir, "list.txt");
  writeFileSync(file, text);
  return file;
}

describe("loadDenyList", () => {
  it("parses kind|regex lines with entry numbers, ignoring comments and blanks", () => {
    const { entries, problem } = loadDenyList(listWith("# note\n\npersonal|ZQ-SENTINEL-7731\nrestricted|ZQ-OTHER-1\n"));
    expect(problem).toBeNull();
    expect(entries.map((e) => [e.kind, e.entry])).toEqual([
      ["personal", 3],
      ["restricted", 4],
    ]);
  });

  it("matches case, Unicode and CRLF variants", () => {
    const { entries, problem } = loadDenyList(listWith("personal|ZQ-Sentinel-7731\r\nrestricted|café-zq\r\n"));
    expect(problem).toBeNull();
    expect(entries[0].pattern.test("xx zq-sentinel-7731 yy")).toBe(true);
    expect(entries[1].pattern.test("CAFÉ-ZQ")).toBe(true);
  });

  it("keeps a pipe inside the regex", () => {
    const { entries } = loadDenyList(listWith("personal|ZQ-A|ZQ-B\n"));
    expect(entries[0].pattern.test("ZQ-B")).toBe(true);
  });

  it("missing file returns problem and no entries", () => {
    dir = mkdtempSync(join(tmpdir(), "lg-deny-"));
    const result = loadDenyList(join(dir, "nope.txt"));
    expect(result.entries).toEqual([]);
    expect(result.problem).toBe("private list not found");
  });

  it("an unreadable path (a directory) returns a fixed problem", () => {
    dir = mkdtempSync(join(tmpdir(), "lg-deny-"));
    const result = loadDenyList(dir);
    expect(result.entries).toEqual([]);
    expect(result.problem).toBe("private list unreadable");
  });

  it('invalid regex returns "entry N invalid" and never the entry text', () => {
    const { problem } = loadDenyList(listWith("personal|ZQ-fine\nrestricted|ZQ-SENTINEL-(broken\n"));
    expect(problem).toBe("entry 2 invalid");
    expect(problem).not.toContain("SENTINEL");
  });

  it("bad kind, missing separator, empty regex and empty-matching regex are invalid", () => {
    const { problem, entries } = loadDenyList(
      listWith("secret|ZQ-A\nZQ-NOSEP\npersonal|\nrestricted|a*\npersonal|ZQ-OK\n"),
    );
    expect(problem).toBe("entry 1 invalid; entry 2 invalid; entry 3 invalid; entry 4 invalid");
    expect(entries.map((e) => e.entry)).toEqual([5]);
  });

  it("a BOM at the start of the file is ignored", () => {
    const { entries, problem } = loadDenyList(listWith("﻿personal|ZQ-A\n"));
    expect(problem).toBeNull();
    expect(entries).toHaveLength(1);
  });
});

describe("defaultDenyListPath", () => {
  it("is under the home directory", () => {
    expect(defaultDenyListPath().startsWith(homedir())).toBe(true);
  });
});

describe("displayPath", () => {
  const entries = () => loadDenyList(listWith("personal|ZQ-SENTINEL-7731\n")).entries;

  it("replaces the matching part with [redacted]", () => {
    expect(displayPath("docs/zq-sentinel-7731-notes.md", entries())).toBe("docs/[redacted]-notes.md");
  });

  it("home directory prints as ~", () => {
    expect(displayPath(join(homedir(), "work", "a.txt"), [])).toBe("~/work/a.txt");
  });

  it("redacts a term that sits inside the home directory path too", () => {
    const e = loadDenyList(listWith("personal|" + homedir().split(/[\\/]/).pop() + "\n")).entries;
    const out = displayPath(join(homedir(), "a.txt"), e);
    expect(out).toBe("~/a.txt");
  });

  it("strips control characters, ANSI escapes and bidi marks", () => {
    expect(displayPath("a\u001b[31mb\u001b[0m\nc\u0007d‮e.txt", [])).toBe("abcde.txt");
  });

  it("redacts a term split by control characters", () => {
    expect(displayPath("ZQ-SEN\u001b[0mTINEL-7731.txt", entries())).toBe("[redacted].txt");
  });
});

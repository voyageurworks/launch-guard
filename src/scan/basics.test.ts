import { afterEach, describe, expect, it } from "vitest";
import { scanBasics } from "./basics.js";
import { makeDir, makeRepo } from "../testRepos.js";

const SLOW = 120_000;
const SENTINEL = "zq-sentinel-7731";
const ALL_BASICS = {
  LICENSE: "MIT\n",
  "SECURITY.md": "Report privately.\n",
  ".github/workflows/ci.yml": "name: ci\n",
};

const cleanups: Array<() => void> = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

function dirWith(files: Record<string, string>) {
  const d = makeDir();
  cleanups.push(d.cleanup);
  for (const [p, t] of Object.entries(files)) d.write(p, t);
  return d;
}

describe("scanBasics", () => {
  it("flags a Windows profile path in CLAUDE.md", () => {
    const d = dirWith({ ...ALL_BASICS, "CLAUDE.md": `# Notes\nWork in C:\\Users\\${SENTINEL}\\notes please\n` });
    const found = scanBasics(d.root);
    expect(found).toEqual([
      { category: "basics", severity: "block", file: "CLAUDE.md", line: 2, label: "user profile path", entry: null },
    ]);
    const json = JSON.stringify(found);
    expect(json).not.toContain(SENTINEL);
    expect(json).not.toContain(JSON.stringify(SENTINEL).slice(1, -1));
  });

  it("flags unix and slash-variant profile paths in AI-assistant files and session notes", () => {
    const d = dirWith({
      ...ALL_BASICS,
      "sub/AGENTS.md": `see /home/${SENTINEL}/x\n`,
      ".claude/rules/a.txt": `C:/Users/${SENTINEL}/x\n`,
      "docs/session-2026.md": `/Users/${SENTINEL}/x\n`,
      "notes/memory/m.txt": `D:\\Users\\${SENTINEL}\n`,
      "app/transcript.json": `{"p":"C:\\\\Users\\\\${SENTINEL}\\\\x"}\n`,
    });
    const found = scanBasics(d.root);
    expect(found.map((f) => f.file).sort()).toEqual(
      [".claude/rules/a.txt", "app/transcript.json", "docs/session-2026.md", "notes/memory/m.txt", "sub/AGENTS.md"].sort(),
    );
    expect(found.every((f) => f.severity === "block" && f.label === "user profile path")).toBe(true);
    expect(JSON.stringify(found)).not.toContain(SENTINEL);
  });

  it("ignores placeholder names, allowed lines and ordinary files", () => {
    const d = dirWith({
      ...ALL_BASICS,
      "CLAUDE.md": [
        "C:\\Users\\<name>\\x",
        "C:\\Users\\%USERNAME%\\x",
        "/home/$USER/x",
        "/home/${USER}/x",
        "/Users/you/x",
        "/home/runner/work",
        "C:\\Users\\Public\\x",
        "/Users/Example/x",
      ].join("\n"),
      "src/readme.md": `/home/${SENTINEL}/x\n`,
    });
    expect(scanBasics(d.root)).toEqual([]);
  });

  const profileFindings = (line: string) => scanBasics(dirWith({ ...ALL_BASICS, "CLAUDE.md": `${line}\n` }).root);

  it("treats All Users and Public as placeholders", () => {
    expect(profileFindings("C:\\Users\\All Users\\Desktop")).toEqual([]);
    expect(profileFindings("C:\\Users\\Public\\x")).toEqual([]);
    expect(profileFindings(`C:\\Users\\All Usersx${SENTINEL}\\x`)).toHaveLength(1);
  });

  it("needs a left boundary and the right case for POSIX forms", () => {
    for (const line of [
      "https://example.com/Users/foo",
      "GET /api/users/:id",
      "/users/123",
      "src/home/page.tsx",
      "app/home/dashboard",
      "/Home/foo",
    ]) {
      expect(profileFindings(line), line).toEqual([]);
    }
    for (const line of [
      `x /Users/${SENTINEL}/x`,
      `(/home/${SENTINEL}/x)`,
      `"C:/Users/${SENTINEL}"`,
      `file:///C:/Users/${SENTINEL}/x`,
      `c:\\users\\${SENTINEL}`,
    ]) {
      expect(profileFindings(line), line).toHaveLength(1);
    }
  });

  it("ignores placeholder names followed by punctuation", () => {
    for (const line of ["see /home/you.", "/Users/user,", "(/home/runner)"]) {
      expect(profileFindings(line), line).toEqual([]);
    }
    expect(profileFindings(`/home/${SENTINEL}.`)).toHaveLength(1);
  });

  it("never leaks a backslash path or its doubled form", () => {
    const found = profileFindings(`C:\\Users\\${SENTINEL}\\notes`);
    expect(found).toHaveLength(1);
    const json = JSON.stringify(found);
    expect(json).not.toContain(SENTINEL);
    expect(json).not.toContain(`C:\\\\Users\\\\${SENTINEL}`);
    expect(json).not.toContain("Users");
  });

  it("flags missing LICENSE, SECURITY and CI as warn", () => {
    const d = dirWith({ "README.md": "hi\n" });
    const found = scanBasics(d.root);
    expect(found.map((f) => [f.severity, f.file, f.line, f.label])).toEqual([
      ["warn", "LICENSE", null, "missing LICENSE"],
      ["warn", "SECURITY", null, "missing SECURITY"],
      ["warn", "CI", null, "missing CI"],
    ]);
  });

  it("accepts alternate LICENSE names, SECURITY in .github or docs, and .yaml workflows", () => {
    const d = dirWith({ "copying.md": "x\n", ".github/SECURITY.md": "x\n", ".github/workflows/b.yaml": "x\n" });
    expect(scanBasics(d.root)).toEqual([]);
    const e = dirWith({ "LICENSE.txt": "x\n", "docs/SECURITY.md": "x\n", ".github/workflows/b.yml": "x\n" });
    expect(scanBasics(e.root)).toEqual([]);
  });

  it("flags an uncommented FUNDING.yml entry", () => {
    const d = dirWith({ ...ALL_BASICS, ".github/FUNDING.yml": "# keep off\n\ngithub: someone\n" });
    expect(scanBasics(d.root)).toEqual([
      { category: "basics", severity: "warn", file: ".github/FUNDING.yml", line: 3, label: "funding file active", entry: null },
    ]);
  });

  it("does not flag a fully commented FUNDING.yml", () => {
    const d = dirWith({ ...ALL_BASICS, ".github/FUNDING.yml": "# github: someone\n   \n  # more\n" });
    expect(scanBasics(d.root)).toEqual([]);
  });

  it("clean repo with all basics gives no findings", () => {
    const d = dirWith({ ...ALL_BASICS, "CLAUDE.md": "# Rules\nUse ~ for home.\n" });
    expect(scanBasics(d.root)).toEqual([]);
  });

  it(
    "does not count untracked ignored files as basics",
    () => {
      const r = makeRepo();
      cleanups.push(r.cleanup);
      r.commit("init", { ".gitignore": "LICENSE\n", "README.md": "hi\n" });
      r.write("LICENSE", "MIT\n");
      const labels = scanBasics(r.root).map((f) => f.label);
      expect(labels).toContain("missing LICENSE");
    },
    SLOW,
  );
});

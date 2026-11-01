import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadDenyList } from "../denylist.js";
import { scanTerms } from "./terms.js";

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    readFileSync: vi.fn(actual.readFileSync),
    openSync: vi.fn(actual.openSync),
  };
});

const SENTINEL = "ZQ-SENTINEL-7731";
let dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "lg-terms-"));
  dirs.push(d);
  return d;
}

function entriesFor(text: string) {
  const file = join(tmp(), "list.txt");
  writeFileSync(file, text);
  return loadDenyList(file).entries;
}

describe("scanTerms", () => {
  it("reports entry number and line but the finding has no matched text", () => {
    const root = tmp();
    writeFileSync(join(root, "a.txt"), `fine\r\nsee ${SENTINEL.toLowerCase()} here\r\n`);
    const entries = entriesFor(`# c\npersonal|${SENTINEL}\n`);
    const findings = scanTerms(root, entries);
    expect(findings).toEqual([
      { category: "personal", severity: "block", file: "a.txt", line: 2, label: "personal detail", entry: 2 },
    ]);
    expect(JSON.stringify(findings)).not.toMatch(/sentinel/i);
  });

  it("matches decomposed Unicode in file content against a composed list entry", () => {
    const root = tmp();
    writeFileSync(join(root, "a.txt"), "CAFÉ-zq\n");
    const findings = scanTerms(root, entriesFor("restricted|café-zq\n"));
    expect(findings.map((f) => f.line)).toEqual([1]);
  });

  it("uses the restricted category and label for restricted entries", () => {
    const root = tmp();
    writeFileSync(join(root, "a.txt"), `x ${SENTINEL}\n`);
    const [f] = scanTerms(root, entriesFor(`restricted|${SENTINEL}\n`));
    expect(f.category).toBe("restricted");
    expect(f.label).toBe("restricted term");
  });

  it("flags a file whose name contains a term and prints the path with that part as [redacted]", () => {
    const root = tmp();
    mkdirSync(join(root, "sub"));
    writeFileSync(join(root, "sub", `notes-${SENTINEL}.md`), "nothing\n");
    const findings = scanTerms(root, entriesFor(`personal|${SENTINEL}\n`));
    expect(findings).toEqual([
      { category: "personal", severity: "block", file: "sub/notes-[redacted].md", line: null, label: "path matches list", entry: 1 },
    ]);
    expect(JSON.stringify(findings)).not.toContain(SENTINEL);
  });

  it("flags files under a folder whose name contains a term", () => {
    const root = tmp();
    mkdirSync(join(root, `${SENTINEL}-dir`));
    writeFileSync(join(root, `${SENTINEL}-dir`, "a.txt"), "x\n");
    const findings = scanTerms(root, entriesFor(`personal|${SENTINEL}\n`));
    expect(findings.map((f) => f.file)).toEqual(["[redacted]-dir/a.txt"]);
  });

  it("list matches stay block in test and example paths; allow markers still work", () => {
    const root = tmp();
    mkdirSync(join(root, "test"));
    mkdirSync(join(root, "docs", "examples"), { recursive: true });
    writeFileSync(join(root, "test", "a.txt"), `${SENTINEL}\n`);
    writeFileSync(join(root, "foo.test.ts"), `${SENTINEL}\n`);
    writeFileSync(join(root, "docs", "examples", "e.md"), `${SENTINEL}\n`);
    writeFileSync(join(root, "b.txt"), `${SENTINEL} // launch-guard-allow: fake value\n// launch-guard-allow: fake\n${SENTINEL}\n${SENTINEL}\n`);
    const findings = scanTerms(root, entriesFor(`personal|${SENTINEL}\nrestricted|${SENTINEL}\n`));
    expect(findings.every((f) => f.severity === "block")).toBe(true);
    const files = new Set(findings.map((f) => f.file));
    expect(files).toEqual(new Set(["b.txt", "test/a.txt", "foo.test.ts", "docs/examples/e.md"]));
    expect(findings.filter((f) => f.file === "b.txt").map((f) => f.line)).toEqual([4, 4]);
  });

  it("a path matching the list stays block under a test directory", () => {
    const root = tmp();
    mkdirSync(join(root, "tests", `${SENTINEL}-dir`), { recursive: true });
    writeFileSync(join(root, "tests", `${SENTINEL}-dir`, "a.txt"), "x\n");
    const findings = scanTerms(root, entriesFor(`personal|${SENTINEL}\n`));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ severity: "block", label: "path matches list" });
  });

  it("skips binary files and does not report skipped content", () => {
    const root = tmp();
    writeFileSync(join(root, "bin.dat"), Buffer.concat([Buffer.from([0]), Buffer.from(SENTINEL)]));
    expect(scanTerms(root, entriesFor(`personal|${SENTINEL}\n`))).toEqual([]);
  });

  it("deny list inside the scanned repo is itself a block finding and is not content-scanned", () => {
    const root = tmp();
    const list = join(root, "private", "list.txt");
    mkdirSync(join(root, "private"));
    writeFileSync(list, `personal|${SENTINEL}\n`);
    const entries = loadDenyList(list).entries;
    const findings = scanTerms(root, entries, list);
    expect(findings).toEqual([
      { category: "basics", severity: "block", file: "private/list.txt", line: null, label: "list inside repo", entry: null },
    ]);
  });

  it("a list outside the repo adds no finding", () => {
    const root = tmp();
    writeFileSync(join(root, "a.txt"), "clean\n");
    const list = join(tmp(), "list.txt");
    writeFileSync(list, `personal|${SENTINEL}\n`);
    expect(scanTerms(root, loadDenyList(list).entries, list)).toEqual([]);
  });


  it("never opens a .env file but still flags one whose name matches the list", () => {
    const root = tmp();
    writeFileSync(join(root, ".env"), `see ${SENTINEL}\n`);
    writeFileSync(join(root, `.env.${SENTINEL.toLowerCase()}`), "x\n");
    vi.mocked(fs.readFileSync).mockClear();
    vi.mocked(fs.openSync).mockClear();
    const findings = scanTerms(root, entriesFor(`personal|${SENTINEL}\n`));
    expect(findings.map((f) => [f.file, f.label])).toEqual([[".env.[redacted]", "path matches list"]]);
    const touched = [...vi.mocked(fs.readFileSync).mock.calls, ...vi.mocked(fs.openSync).mock.calls].map((c) => String(c[0]));
    expect(touched.some((p) => /[\/]\.env/.test(p))).toBe(false);
  });
});

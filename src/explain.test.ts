import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { main } from "./cli.js";
import { EXPLAIN, explainLabel } from "./explain.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => void out.push(s), err: (s: string) => void err.push(s) }, out, err };
}

/** The "Reading the report" table in README.md, as label -> text in the same shape EXPLAIN uses. */
function readmeTable(): Map<string, string> {
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  const start = readme.indexOf("| Label | What it means | What to do |");
  const end = readme.indexOf("For a harmless match");
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const map = new Map<string, string>();
  for (const row of readme.slice(start, end).split("\n")) {
    if (!row.startsWith("| ") || row.startsWith("| Label") || row.startsWith("| ---")) continue;
    const cells = row.slice(2, -2).split(" | ");
    for (const name of cells[0]!.split(", ")) map.set(name.trim(), `${cells[1]}\nWhat to do: ${cells.slice(2).join(" | ")}`);
  }
  return map;
}

describe("EXPLAIN stays in step with the README", () => {
  it("has exactly the labels the README table documents, with identical text", () => {
    const table = readmeTable();
    expect([...table.keys()].sort()).toEqual(Object.keys(EXPLAIN).sort());
    for (const [label, text] of table) expect(EXPLAIN[label as keyof typeof EXPLAIN], label).toBe(text);
  });

  it("every entry says what to do", () => {
    for (const [label, text] of Object.entries(EXPLAIN)) expect(text, label).toContain("What to do: ");
  });
});

describe("explainLabel", () => {
  it("returns the text for a known label and null for anything else, including object property names", () => {
    expect(explainLabel("secret format")).toContain("What to do: ");
    expect(explainLabel("zq-not-a-label")).toBeNull();
    expect(explainLabel("constructor")).toBeNull();
    expect(explainLabel("__proto__")).toBeNull();
    expect(explainLabel("")).toBeNull();
  });
});

describe("--explain", () => {
  it("prints the explanation and exits 0, touching nothing else", async () => {
    const c = capture();
    expect(await main(["--explain", "source map with sources"], c.io)).toBe(0);
    expect(c.out.join("")).toBe(`${EXPLAIN["source map with sources"]}\n`);
    expect(c.err).toEqual([]);
  });

  it("an unknown label exits 2 with a fixed message that lists the known labels and never echoes the argument", async () => {
    const c = capture();
    expect(await main(["--explain", "zq-secret-argument-7731"], c.io)).toBe(2);
    expect(c.out).toEqual([]);
    const text = c.err.join("");
    expect(text).toContain("unknown label");
    expect(text).toContain("secret format");
    expect(text).not.toContain("zq-secret-argument-7731");
  });

  it.each([
    [["--explain"]],
    [["--explain", ""]],
    [["--explain", "secret format", "--pack"]],
    [["--explain", "secret format", "--json"]],
    [["--explain", "secret format", "."]],
    [["--explain", "secret format", "--explain", "env file in package"]],
    [["--explain", "secret format", "--print-hook"]],
    [["--explain", "secret format", "--init-list"]],
    [["--explain", "secret format", "--fail-on", "warn"]],
  ])("rejects %j with exit 2 and the usage hint", async (argv) => {
    const c = capture();
    expect(await main(argv, c.io)).toBe(2);
    expect(c.out).toEqual([]);
    expect(c.err.join("")).toContain("Usage: launch-guard");
  });

  it("--help documents --explain", async () => {
    const c = capture();
    expect(await main(["--help"], c.io)).toBe(0);
    expect(c.out.join("")).toContain("--explain");
  });
});

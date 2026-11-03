import { afterEach, describe, expect, it } from "vitest";
import { isEnvFile, listRepoFiles } from "../files.js";
import { makeDir } from "../testRepos.js";
import type { Finding } from "../types.js";
import { scanPackageFiles, scanPackageManifest } from "./pack.js";

const dirs: Array<{ cleanup(): void }> = [];
function pkg(files: Record<string, string>) {
  const d = makeDir("lg-pk-");
  dirs.push(d);
  for (const [p, t] of Object.entries(files)) d.write(p, t);
  return d.root;
}
afterEach(() => {
  while (dirs.length) dirs.pop()!.cleanup();
});

function scan(files: Record<string, string>): Finding[] {
  const root = pkg(files);
  return scanPackageFiles(root, listRepoFiles(root, isEnvFile, { includeAll: true }));
}
const pick = (fs: Finding[]) => fs.map((f) => `${f.severity}:${f.label}:${f.file}`).sort();

// Built at run time so this file holds nothing key-shaped.
const PEM_BEGIN = "-----BEGIN " + "RSA PRIVATE KEY-----";

describe("scanPackageFiles: names", () => {
  it.each([".claude", ".codex", ".cursor", ".gemini", ".windsurf"])("blocks anything under %s/", (dir) => {
    expect(pick(scan({ [`${dir}/anything.json`]: "{}" }))).toEqual([`block:agent folder in package:${dir}/anything.json`]);
  });

  it("blocks an agent folder nested deeper in the package", () => {
    expect(pick(scan({ "lib/.cursor/rules.md": "x" }))).toEqual(["block:agent folder in package:lib/.cursor/rules.md"]);
  });

  it("blocks settings.local.json anywhere", () => {
    expect(pick(scan({ "config/settings.local.json": "{}" }))).toEqual(["block:agent folder in package:config/settings.local.json"]);
  });

  it("warns about instruction files and memory folders", () => {
    expect(pick(scan({ "CLAUDE.md": "x", "memory/notes.md": "y" }))).toEqual([
      "warn:agent file in package:CLAUDE.md",
      "warn:agent file in package:memory/notes.md",
    ]);
  });

  it("blocks session and transcript files, but not inside node_modules", () => {
    expect(pick(scan({ "session-2026.jsonl": "{}", "node_modules/dep/test/session.json": "{}" }))).toEqual([
      "block:agent file in package:session-2026.jsonl",
    ]);
  });

  it("blocks env files but not templates", () => {
    expect(pick(scan({ ".env": "A=1", ".env.local": "A=1", ".env.example": "A=" }))).toEqual([
      "block:env file in package:.env",
      "block:env file in package:.env.local",
    ]);
  });

  it("blocks .npmrc", () => {
    expect(pick(scan({ ".npmrc": "x" }))).toEqual(["block:.npmrc in package:.npmrc"]);
  });

  it("blocks .git data", () => {
    expect(pick(scan({ ".git/config": "[core]" }))).toEqual(["block:git data in package:.git/config"]);
  });

  it("blocks private SSH key names but not .pub files", () => {
    expect(pick(scan({ "keys/id_rsa": "x", "keys/id_ed25519": "x", "keys/id_rsa.pub": "ssh-rsa AAAA" }))).toEqual([
      "block:private key file in package:keys/id_ed25519",
      "block:private key file in package:keys/id_rsa",
    ]);
  });

  it("blocks a .pem that holds a private key and only warns about one that does not", () => {
    const f = scan({ "a/private.pem": `${PEM_BEGIN}\nabc\n`, "b/ca.pem": "-----BEGIN CERTIFICATE-----\nabc\n" });
    expect(pick(f)).toEqual(["block:private key file in package:a/private.pem", "warn:key or certificate file in package:b/ca.pem"]);
  });

  it("blocks .p12 and .pfx bundles by name", () => {
    expect(pick(scan({ "x.p12": "x", "y.pfx": "y" }))).toEqual([
      "block:private key file in package:x.p12",
      "block:private key file in package:y.pfx",
    ]);
  });

  it("is quiet for a normal package", () => {
    expect(scan({ "package.json": "{}", "dist/index.js": "1", "README.md": "r", "LICENSE": "MIT" })).toEqual([]);
  });

  it("matches names case-insensitively", () => {
    expect(pick(scan({ ".CLAUDE/x.json": "{}", ".ENV": "A=1" }))).toEqual([
      "block:agent folder in package:.CLAUDE/x.json",
      "block:env file in package:.ENV",
    ]);
  });
});

describe("scanPackageFiles: source maps", () => {
  it("warns when sourcesContent holds source text", () => {
    const map = JSON.stringify({ version: 3, sources: ["a.ts"], sourcesContent: ["const secret = 1;"], mappings: "" });
    expect(pick(scan({ "dist/a.js.map": map }))).toEqual(["warn:source map with sources:dist/a.js.map"]);
  });

  it("is quiet for a map without embedded sources", () => {
    expect(scan({ "dist/a.js.map": JSON.stringify({ version: 3, sources: ["a.ts"], mappings: "" }) })).toEqual([]);
    expect(scan({ "dist/b.js.map": JSON.stringify({ version: 3, sourcesContent: [null], mappings: "" }) })).toEqual([]);
    expect(scan({ "dist/c.js.map": JSON.stringify({ version: 3, sourcesContent: [], mappings: "" }) })).toEqual([]);
  });

  it("warns about a map that is not valid JSON", () => {
    expect(pick(scan({ "dist/a.js.map": "not json {" }))).toEqual(["warn:source map in package:dist/a.js.map"]);
  });

  it("still inspects a map larger than the normal 1 MiB scan cap", () => {
    const big = JSON.stringify({ version: 3, sourcesContent: ["x".repeat(1_200_000)], mappings: "" });
    expect(pick(scan({ "dist/big.js.map": big }))).toEqual(["warn:source map with sources:dist/big.js.map"]);
  });
});

describe("scanPackageManifest", () => {
  function manifest(pkgJson: string | null, sourceFiles: Record<string, string> = {}): Finding[] {
    const root = pkg(pkgJson === null ? { "x.txt": "x" } : { "package.json": pkgJson });
    const src = pkg({ "placeholder.txt": "p", ...sourceFiles });
    return scanPackageManifest(root, src);
  }

  it("warns when there is no files list and no .npmignore in the source", () => {
    expect(pick(manifest('{"name":"a"}'))).toEqual(["warn:no files list in package:package.json"]);
  });

  it("is quiet with a files list", () => {
    expect(manifest('{"name":"a","files":["dist"]}')).toEqual([]);
  });

  it("is quiet with a .npmignore in the source folder", () => {
    expect(manifest('{"name":"a"}', { ".npmignore": "test\n" })).toEqual([]);
  });

  it("warns about install-time scripts", () => {
    const f = manifest('{"name":"a","files":["dist"],"scripts":{"postinstall":"node x.js","test":"vitest"}}');
    expect(pick(f)).toEqual(["warn:install script in package:package.json"]);
  });

  it("flags each of install, preinstall and postinstall once", () => {
    const f = manifest('{"files":["d"],"scripts":{"install":"a","preinstall":"b","postinstall":"c"}}');
    expect(f).toHaveLength(1);
  });

  it("says nothing when package.json is missing or unreadable", () => {
    expect(manifest(null)).toEqual([]);
    expect(manifest("{ not json")).toEqual([]);
  });

  it("treats a non-array files value as no files list", () => {
    expect(pick(manifest('{"files":"dist"}'))).toEqual(["warn:no files list in package:package.json"]);
  });
});

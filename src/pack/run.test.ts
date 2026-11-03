import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { scanSecrets } from "../scan/secrets.js";
import { scanTerms } from "../scan/terms.js";
import { makeDir } from "../testRepos.js";
import { makeTgz } from "../testTar.js";
import type { TarEntry } from "../testTar.js";
import type { DenyEntry } from "../denylist.js";
import { scanPackage } from "./run.js";
import type { PackScanners } from "./run.js";

// Built at run time so this file holds nothing key-shaped.
const FAKE_AWS = "AKI" + "A" + "ZQSENTINEL7731" + "XY";
const SENTINEL = "zqsentinel";

const dirs: Array<{ cleanup(): void }> = [];
afterEach(() => {
  while (dirs.length) dirs.pop()!.cleanup();
});

/** A fake `npm pack` that writes the given tarball entries, and records where it was told to write. */
function deps(entries: TarEntry[] | null | Buffer): PackScanners & { dest: string[] } {
  const dest: string[] = [];
  return {
    dest,
    pack(_cwd, destDir) {
      dest.push(destDir);
      if (entries === null) return null;
      const file = join(destDir, "demo-1.0.0.tgz");
      writeFileSync(file, Buffer.isBuffer(entries) ? entries : makeTgz(entries));
      return file;
    },
    secrets: scanSecrets,
    terms: scanTerms,
  };
}

function source() {
  const d = makeDir("lg-psrc-");
  dirs.push(d);
  return d.root;
}

const NO_ENTRIES: DenyEntry[] = [];
const labels = (fs: Array<{ severity: string; label: string; file: string }>) => fs.map((f) => `${f.severity}:${f.label}:${f.file}`);

describe("scanPackage", () => {
  it("scans what the tarball holds, including dist and node_modules, and reports package-relative paths", () => {
    const d = deps([
      { name: "package/package.json", data: '{"name":"demo","files":["dist"]}' },
      { name: "package/dist/config.js", data: `module.exports = { aws: "${FAKE_AWS}" };\n` },
      { name: "package/node_modules/dep/index.js", data: `var k = "${FAKE_AWS}";\n` },
      { name: "package/.claude/settings.local.json", data: "{}" },
    ]);
    const r = scanPackage(source(), NO_ENTRIES, d);
    if (!r.ok) throw new Error("expected ok");
    expect(labels(r.findings)).toEqual(
      expect.arrayContaining([
        "block:secret format:dist/config.js",
        "block:secret format:node_modules/dep/index.js",
        "block:agent folder in package:.claude/settings.local.json",
      ]),
    );
    expect(JSON.stringify(r.findings)).not.toContain(FAKE_AWS);
    expect(JSON.stringify(r.findings)).not.toContain("package/dist");
  });

  it("adds the fixed info notes and the content summary for a clean package", () => {
    const d = deps([
      { name: "package/package.json", data: '{"name":"demo","files":["index.js"]}' },
      { name: "package/index.js", data: "module.exports = 1;\n" },
    ]);
    const r = scanPackage(source(), NO_ENTRIES, d);
    if (!r.ok) throw new Error("expected ok");
    expect(r.findings.some((f) => f.severity === "block" || f.severity === "warn")).toBe(false);
    expect(r.findings.map((f) => f.label)).toEqual(
      expect.arrayContaining(["packed without running scripts", "history not part of a package", "package contents"]),
    );
    const contents = r.findings.find((f) => f.label === "package contents")!;
    expect(contents.file).toMatch(/^2 files, \d+(?:\.\d)? (?:B|KiB|MiB) unpacked$/);
  });

  it("reports links as info and unsafe names as a warning, without listing the unsafe name", () => {
    const d = deps([
      { name: "package/package.json", data: '{"files":["x"]}' },
      { name: "package/link", type: "2", linkname: "elsewhere" },
      { name: "package/../escape-zqsentinel.txt", data: "x" },
    ]);
    const r = scanPackage(source(), NO_ENTRIES, d);
    if (!r.ok) throw new Error("expected ok");
    expect(labels(r.findings)).toEqual(expect.arrayContaining(["info:link in package:link", "warn:unsafe path in package:package"]));
    expect(JSON.stringify(r.findings)).not.toContain("escape");
  });

  // Not run on Windows (aux is a device name there); the Linux and macOS jobs cover it.
  it.skipIf(process.platform === "win32")("scans a file named like a Windows device (lib/aux.js) where that name is valid", () => {
    const d = deps([
      { name: "package/package.json", data: '{"files":["lib"]}' },
      { name: "package/lib/aux.js", data: `k = "${FAKE_AWS}";\n` },
    ]);
    const r = scanPackage(source(), NO_ENTRIES, d);
    if (!r.ok) throw new Error("expected ok");
    expect(labels(r.findings)).toContain("block:secret format:lib/aux.js");
    expect(r.findings.some((f) => f.label === "unsafe path in package")).toBe(false);
  });

  it("does not run git inside an unpacked .git folder, and blocks it", () => {
    const d = deps([
      { name: "package/package.json", data: '{"files":["x"]}' },
      { name: "package/.git/config", data: "[core]\n\tfsmonitor = echo owned\n" },
    ]);
    const r = scanPackage(source(), NO_ENTRIES, d);
    if (!r.ok) throw new Error("expected ok");
    expect(labels(r.findings)).toContain("block:git data in package:.git/config");
  });

  it("applies the private list to contents and names, printing neither", () => {
    const entries: DenyEntry[] = [{ kind: "restricted", pattern: new RegExp(SENTINEL, "iu"), entry: 3 }];
    const d = deps([
      { name: "package/package.json", data: '{"files":["x"]}' },
      { name: "package/notes.txt", data: `mentions ${SENTINEL} here\n` },
      { name: `package/${SENTINEL}-file.txt`, data: "plain\n" },
    ]);
    const r = scanPackage(source(), entries, d);
    if (!r.ok) throw new Error("expected ok");
    expect(r.findings.some((f) => f.label === "restricted term" && f.file === "notes.txt" && f.entry === 3)).toBe(true);
    expect(r.findings.some((f) => f.label === "path matches list" && f.entry === 3)).toBe(true);
    expect(JSON.stringify(r.findings).toLowerCase()).not.toContain(SENTINEL);
  });

  it("checks the manifest against the source folder's .npmignore", () => {
    const src = makeDir("lg-psrc-");
    dirs.push(src);
    src.write(".npmignore", "test\n");
    const withIgnore = scanPackage(src.root, NO_ENTRIES, deps([{ name: "package/package.json", data: '{"name":"demo"}' }]));
    if (!withIgnore.ok) throw new Error("expected ok");
    expect(withIgnore.findings.some((f) => f.label === "no files list in package")).toBe(false);
    const without = scanPackage(source(), NO_ENTRIES, deps([{ name: "package/package.json", data: '{"name":"demo"}' }]));
    if (!without.ok) throw new Error("expected ok");
    expect(without.findings.some((f) => f.label === "no files list in package")).toBe(true);
  });

  it("says the build failed when npm gives no tarball", () => {
    expect(scanPackage(source(), NO_ENTRIES, deps(null))).toEqual({ ok: false, reason: "build" });
  });

  it("says the package could not be read when the tarball is damaged", () => {
    expect(scanPackage(source(), NO_ENTRIES, deps(Buffer.from("garbage")))).toEqual({ ok: false, reason: "read" });
  });

  it("removes both working folders on success and on failure", () => {
    const ok = deps([{ name: "package/package.json", data: "{}" }]);
    scanPackage(source(), NO_ENTRIES, ok);
    const bad = deps(Buffer.from("garbage"));
    scanPackage(source(), NO_ENTRIES, bad);
    for (const d of [...ok.dest, ...bad.dest]) {
      expect(existsSync(d)).toBe(false);
      expect(existsSync(join(d, ".."))).toBe(false); // the shared work folder is gone too
    }
  });

  it("notes files that were too large or binary to scan, as the repo scan does", () => {
    const d = deps([
      { name: "package/package.json", data: '{"files":["x"]}' },
      { name: "package/blob.bin", data: Buffer.from([1, 0, 2, 0]) },
    ]);
    const r = scanPackage(source(), NO_ENTRIES, d);
    if (!r.ok) throw new Error("expected ok");
    expect(labels(r.findings)).toContain("info:file skipped:blob.bin");
  });
});

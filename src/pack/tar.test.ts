import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import { makeDir } from "../testRepos.js";
import { makeTar, makeTgz, paxRecord } from "../testTar.js";
import { TarError, extractTarball } from "./tar.js";

const dirs: Array<{ cleanup(): void }> = [];
function dest() {
  const d = makeDir("lg-tar-");
  dirs.push(d);
  return d.root;
}
afterEach(() => {
  while (dirs.length) dirs.pop()!.cleanup();
});

describe("extractTarball", () => {
  it("writes files with the package/ prefix removed and lists them", () => {
    const out = dest();
    const r = extractTarball(
      makeTgz([
        { name: "package/", type: "5" },
        { name: "package/package.json", data: '{"name":"x"}' },
        { name: "package/dist/index.js", data: "console.log(1)" },
      ]),
      out,
    );
    expect(r.files.sort()).toEqual(["dist/index.js", "package.json"]);
    expect(readFileSync(join(out, "dist/index.js"), "utf8")).toBe("console.log(1)");
    expect(r.links).toEqual([]);
    expect(r.unsafe).toBe(0);
  });

  it("uses the ustar prefix field for long paths", () => {
    const out = dest();
    const r = extractTarball(makeTgz([{ name: "file.txt", prefix: "package/a/b", data: "hi" }]), out);
    expect(r.files).toEqual(["a/b/file.txt"]);
  });

  it("reads a pax path header for names longer than 100 bytes", () => {
    const out = dest();
    const long = "package/" + "d".repeat(60) + "/" + "e".repeat(60) + "/f.txt";
    const r = extractTarball(
      makeTgz([
        { name: "PaxHeader", type: "x", data: paxRecord("path", long) },
        { name: "short", data: "body" },
      ]),
      out,
    );
    expect(r.files).toEqual(["d".repeat(60) + "/" + "e".repeat(60) + "/f.txt"]);
  });

  it("reads a GNU long name entry", () => {
    const out = dest();
    const long = "package/" + "g".repeat(150) + ".txt";
    const r = extractTarball(
      makeTgz([
        { name: "././@LongLink", type: "L", data: long + "\0" },
        { name: "truncated", data: "x" },
      ]),
      out,
    );
    expect(r.files).toEqual(["g".repeat(150) + ".txt"]);
  });

  it("ignores a pax global header", () => {
    const out = dest();
    const r = extractTarball(
      makeTgz([
        { name: "pax_global_header", type: "g", data: paxRecord("comment", "abc") },
        { name: "package/a.txt", data: "a" },
      ]),
      out,
    );
    expect(r.files).toEqual(["a.txt"]);
  });

  it("does not create symlinks or hard links, and lists them", () => {
    const out = dest();
    const r = extractTarball(
      makeTgz([
        { name: "package/link", type: "2", linkname: "../../etc/passwd" },
        { name: "package/hard", type: "1", linkname: "package/a.txt" },
        { name: "package/a.txt", data: "a" },
      ]),
      out,
    );
    expect(r.links.sort()).toEqual(["hard", "link"]);
    expect(readdirSync(out)).toEqual(["a.txt"]);
  });

  it.each([
    ["parent segment", "package/../evil.txt"],
    ["nested parent segment", "package/a/../../evil.txt"],
    ["absolute path", "/etc/evil.txt"],
    ["drive letter", "C:/evil.txt"],
    ["backslash separator", "package/a\\..\\evil.txt"],
  ])("refuses an unsafe entry (%s) without writing outside", (_label, name) => {
    const out = dest();
    const parent = join(out, "..");
    const r = extractTarball(makeTgz([{ name, data: "x" }, { name: "package/ok.txt", data: "ok" }]), out);
    expect(r.unsafe).toBe(1);
    expect(r.files).toEqual(["ok.txt"]);
    expect(existsSync(join(parent, "evil.txt"))).toBe(false);
    expect(existsSync(join(out, "evil.txt"))).toBe(false);
  });

  describe("Windows-only file name rules", () => {
    const entries = [
      { name: "package/lib/aux.js", data: "a" },
      { name: "package/notes:1.txt", data: "b" },
      { name: "package/trailing.", data: "c" },
      { name: "package/ok.js", data: "d" },
    ];

    // Skipped on Windows on purpose: there ':' would create an alternate data stream and 'aux' is a device name.
    it.skipIf(process.platform === "win32")("are off where those names are valid, so the files are still extracted and scanned", () => {
      const r = extractTarball(makeTgz(entries), dest(), { windowsNames: false });
      expect(r.unsafe).toBe(0);
      expect(r.files.sort()).toEqual(["lib/aux.js", "notes:1.txt", "ok.js", "trailing."]);
    });

    it("are on for Windows: reserved names, ':' and a trailing dot are refused", () => {
      const r = extractTarball(makeTgz(entries), dest(), { windowsNames: true });
      expect(r.unsafe).toBe(3);
      expect(r.files).toEqual(["ok.js"]);
    });

    it("never relax the traversal, drive letter, backslash and control character rules", () => {
      const bad = [
        { name: "package/../x.txt", data: "x" },
        { name: "C:/x.txt", data: "x" },
        { name: "package/a\\b.txt", data: "x" },
        { name: "package/a\u0001b.txt", data: "x" },
      ];
      const r = extractTarball(makeTgz(bad), dest(), { windowsNames: false });
      expect(r.unsafe).toBe(4);
      expect(r.files).toEqual([]);
    });
  });

  it("rejects a corrupt gzip stream", () => {
    expect(() => extractTarball(Buffer.from("not a tarball"), dest())).toThrow(TarError);
  });

  it("rejects a bad header checksum", () => {
    expect(() => extractTarball(makeTgz([{ name: "package/a.txt", data: "a", badChecksum: true }]), dest())).toThrow(TarError);
  });

  it("rejects an archive cut off inside a file", () => {
    const tar = makeTar([{ name: "package/a.txt", data: "a".repeat(2000) }]);
    const cut = gzipSync(tar.subarray(0, 512 + 600));
    expect(() => extractTarball(cut, dest())).toThrow(TarError);
  });

  it("rejects an archive that claims more bytes than it holds", () => {
    expect(() => extractTarball(makeTgz([{ name: "package/a.txt", data: "a", sizeField: 99_999_999 }]), dest())).toThrow(TarError);
  });

  it("enforces the total uncompressed size cap", () => {
    const tgz = makeTgz([{ name: "package/big.txt", data: "a".repeat(100_000) }]);
    expect(() => extractTarball(tgz, dest(), { maxTotalBytes: 50_000 })).toThrow(TarError);
  });

  it("enforces the file count cap", () => {
    const tgz = makeTgz([1, 2, 3].map((n) => ({ name: `package/f${n}.txt`, data: "x" })));
    expect(() => extractTarball(tgz, dest(), { maxFiles: 2 })).toThrow(TarError);
  });

  it("accepts an empty archive", () => {
    const r = extractTarball(makeTgz([]), dest());
    expect(r.files).toEqual([]);
  });

  it("keeps a later duplicate of the same path (last wins) and lists it once", () => {
    const out = dest();
    const r = extractTarball(makeTgz([{ name: "package/a.txt", data: "one" }, { name: "package/a.txt", data: "two" }]), out);
    expect(r.files).toEqual(["a.txt"]);
    expect(readFileSync(join(out, "a.txt"), "utf8")).toBe("two");
  });
});

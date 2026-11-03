import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { displayPath } from "../denylist.js";
import type { DenyEntry } from "../denylist.js";
import { isEnvFile, listRepoFiles } from "../files.js";
import type { RepoFile } from "../files.js";
import { scanAiFiles } from "../scan/basics.js";
import { scanPackageFiles, scanPackageManifest } from "../scan/pack.js";
import { skippedNotes } from "../skipped.js";
import type { Finding, Label, Severity } from "../types.js";
import { TarError, extractTarball } from "./tar.js";

/** The pieces `scanPackage` needs. The CLI passes the real ones; tests may replace `pack` with a fake. */
export interface PackScanners {
  /** Builds the tarball for the project in `cwd` inside `destDir` and returns its path, or null on any failure. */
  pack(cwd: string, destDir: string): string | null;
  secrets(root: string, entries: DenyEntry[], files?: RepoFile[]): Finding[];
  terms(root: string, entries: DenyEntry[], listFile?: string, files?: RepoFile[]): Finding[];
}

export type PackOutcome = { ok: true; findings: Finding[] } | { ok: false; reason: "build" | "read" };

function note(severity: Severity, file: string, label: Label): Finding {
  return { category: "package", severity, file, line: null, label, entry: null };
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/**
 * Packs the project at `sourceRoot` the way `npm publish` would (without running scripts), unpacks the tarball into a
 * fresh temp folder and runs the scanners on what is inside. Both temp folders are removed before returning, also on
 * failure. Findings show paths inside the package, fixed labels and numbers only.
 */
export function scanPackage(sourceRoot: string, entries: DenyEntry[], deps: PackScanners): PackOutcome {
  const work = mkdtempSync(join(tmpdir(), "lg-pack-"));
  try {
    const tgzDir = join(work, "tgz");
    const pkgDir = join(work, "pkg");
    mkdirSync(tgzDir);
    mkdirSync(pkgDir);

    const tgzPath = deps.pack(sourceRoot, tgzDir);
    if (tgzPath === null) return { ok: false, reason: "build" };

    let extracted;
    try {
      extracted = extractTarball(readFileSync(tgzPath), pkgDir);
    } catch (err) {
      if (err instanceof TarError) return { ok: false, reason: "read" };
      throw err;
    }

    // Everything that ships is scanned: .git, node_modules and dist are not skipped, and git is never asked.
    const files = listRepoFiles(pkgDir, isEnvFile, { includeAll: true });
    const found: Finding[] = [
      ...deps.secrets(pkgDir, entries, files),
      ...(entries.length > 0 ? deps.terms(pkgDir, entries, undefined, files) : []),
      ...scanPackageFiles(pkgDir, files),
      ...scanPackageManifest(pkgDir, sourceRoot),
      ...scanAiFiles(pkgDir, entries, files),
    ].map((f) => (f.category === "package" ? { ...f, file: displayPath(f.file, entries) } : f));

    for (const link of extracted.links) found.push(note("info", displayPath(link, entries), "link in package"));
    if (extracted.unsafe > 0) found.push(note("warn", "package", "unsafe path in package"));
    found.push(...skippedNotes(files, entries));

    let bytes = 0;
    for (const f of extracted.files) {
      try {
        bytes += lstatSync(join(pkgDir, ...f.split("/"))).size;
      } catch {
        // a file that cannot be measured adds nothing to the total
      }
    }
    found.push(note("info", "npm pack", "packed without running scripts"));
    found.push(note("info", "history", "history not part of a package"));
    found.push(note("info", `${extracted.files.length} files, ${formatSize(bytes)} unpacked`, "package contents"));
    return { ok: true, findings: found };
  } finally {
    rmSync(work, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

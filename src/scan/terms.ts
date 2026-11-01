import { readFileSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isAllowed } from "../allow.js";
import { cleanText, displayPath } from "../denylist.js";
import type { DenyEntry } from "../denylist.js";
import { isEnvFile, listRepoFiles } from "../files.js";
import type { RepoFile } from "../files.js";
import type { Finding } from "../types.js";

function real(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** Repo-relative forward-slash path of `file` when it lies inside `root`, else null. */
function insideRepo(root: string, file: string): string | null {
  let rel = relative(real(root), real(file));
  if (process.platform === "win32" && /^[a-z]:/i.test(rel)) return null;
  if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return null;
  rel = rel.replace(/\\/g, "/");
  return rel;
}

/** Entries whose pattern matches `text` (NFC-normalised first, as lists and content are). Shared with the history scan. */
export function matchingEntries(text: string, entries: DenyEntry[]): DenyEntry[] {
  const t = text.normalize("NFC");
  return entries.filter((e) => e.pattern.test(t));
}

/**
 * Matches every private-list entry against file contents and file/folder names. Findings carry the entry
 * number and a fixed label, never the matched text; paths print through `displayPath`.
 */
export function scanTerms(root: string, entries: DenyEntry[], listFile?: string, listing?: RepoFile[]): Finding[] {
  const findings: Finding[] = [];
  const listRel = listFile ? insideRepo(root, listFile) : null;
  if (listRel !== null) {
    findings.push({
      category: "basics",
      severity: "block",
      file: displayPath(listRel, entries),
      line: null,
      label: "list inside repo",
      entry: null,
    });
  }
  if (entries.length === 0) return findings;

  for (const f of listing ?? listRepoFiles(root, isEnvFile)) {
    const shown = displayPath(f.path, entries);
    const cleanPath = cleanText(f.path);
    for (const e of entries) {
      if (e.pattern.test(cleanPath)) {
        findings.push({
          category: e.kind,
          severity: "block",
          file: shown,
          line: null,
          label: "path matches list",
          entry: e.entry,
        });
      }
    }
    if (f.skipped || f.path === listRel || isEnvFile(f.path)) continue;

    let text: string;
    try {
      text = readFileSync(join(root, f.path), "utf8").normalize("NFC");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, i) => {
      const previous = i > 0 ? lines[i - 1] : "";
      if (isAllowed(line, previous)) return;
      for (const e of matchingEntries(line, entries)) {
        findings.push({
          category: e.kind,
          severity: "block",
          file: shown,
          line: i + 1,
          label: e.kind === "personal" ? "personal detail" : "restricted term",
          entry: e.entry,
        });
      }
    });
  }
  return findings;
}

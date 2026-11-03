import { displayPath } from "./denylist.js";
import type { DenyEntry } from "./denylist.js";
import type { RepoFile } from "./files.js";
import type { Finding } from "./types.js";

const MAX_SKIPPED_NOTES = 25;

/** Info notes for files the scanners could not read (binary, large, symlink, unreadable), capped, paths printed safely. */
export function skippedNotes(files: RepoFile[], entries: DenyEntry[]): Finding[] {
  const skipped = files.filter((f) => f.skipped !== undefined);
  const notes: Finding[] = skipped.slice(0, MAX_SKIPPED_NOTES).map((f) => ({
    category: "basics",
    severity: "info",
    file: displayPath(f.path, entries),
    line: null,
    label: "file skipped",
    entry: null,
  }));
  if (skipped.length > MAX_SKIPPED_NOTES) {
    notes.push({ category: "basics", severity: "info", file: "files", line: null, label: "more files skipped", entry: null });
  }
  return notes;
}

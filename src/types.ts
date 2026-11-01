export type Severity = "block" | "warn" | "info";

export type Category = "secret" | "personal" | "restricted" | "history" | "reachability" | "basics";

/** Fixed text written by the tool. Never matched text or text from a file. Later tasks add members. */
export type Label =
  | "secret format"
  | "secret near keyword"
  | "personal detail"
  | "restricted term"
  | "path matches list"
  | "tracked env file"
  | "list inside repo"
  | "secret in history"
  | "term in history"
  | "history incomplete"
  | "no commits"
  | "recommend a fresh repository"
  | "extra ref"
  | "unreachable object"
  | "not a repository root"
  | "no remote"
  | "remote not checked"
  | "user profile path"
  | "missing LICENSE"
  | "missing SECURITY"
  | "missing CI"
  | "funding file active"
  | "checks skipped: no private list"
  | "private list has no entries"
  | "file skipped"
  | "more files skipped"
  | "submodule not scanned"
  | "nested repository not scanned";

/** `entry` is the private-list line number. No field may hold matched text. */
export interface Finding {
  category: Category;
  severity: Severity;
  file: string;
  line: number | null;
  label: Label;
  entry: number | null;
}

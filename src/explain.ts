import type { Label } from "./types.js";

/**
 * What each report label means and what to do about it. Generated from the "Reading the report" table in README.md and
 * kept identical to it by explain.test.ts, which fails when either side changes alone. Fixed text only: nothing from a
 * scanned repository can reach it.
 */
export const EXPLAIN: Record<Label, string> = {
  "secret format": "A string shaped like a known key or token\nWhat to do: Remove it from the file, then treat the key as exposed and replace it at its provider",
  "secret near keyword": "A long random-looking value next to a word like key, token or password\nWhat to do: Check the line yourself; remove it, or mark it allowed if it is harmless (see below)",
  "personal detail": "A `personal` entry from your list matches in a file\nWhat to do: Edit the line yourself",
  "restricted term": "A `restricted` entry from your list matches in a file\nWhat to do: Edit the line yourself",
  "path matches list": "A file or folder name matches your list (shown as `[redacted]`)\nWhat to do: Rename it",
  "tracked env file": "A `.env` file is tracked by git (its contents are never read)\nWhat to do: Stop tracking it and keep it out of the repo; replace any secrets in it",
  "list inside repo": "Your private list is inside the folder being scanned\nWhat to do: Move it out of the repo",
  "secret in history": "A secret appears in an old version of a file\nWhat to do: See the note on history below",
  "term in history": "A list entry appears in an old commit, message, author or ref name\nWhat to do: See the note on history below",
  "history incomplete": "The tool could not look at part of the history\nWhat to do: Informational; the check for that part did not run",
  "no commits": "The tool could not look at part of the history\nWhat to do: Informational; the check for that part did not run",
  "recommend a fresh repository": "A rewrite leftover (`refs/original`) or a hidden pull-request ref on a remote would stay reachable\nWhat to do: Publish from a brand-new repository with no old history",
  "extra ref": "A branch, tag or stash beyond the current branch\nWhat to do: Check whether it should be public",
  "unreachable object": "Git still holds an object that no branch reaches. Staging, amending, rebasing and `git stash drop` all leave these until git cleans up. They are local and a push does not publish them\nWhat to do: A warn, not proof of a leak: check that nothing sensitive was in the file you changed. To clear them, run `git reflog expire --expire-unreachable=now --all`, then `git gc --prune=now` (`git gc --prune=now` alone only clears re-staged blobs and dropped stash entries, because the reflog still holds commits left by an amend or rebase)",
  "not a repository root": "The folder is not the top level of a git repository (a plain folder, or a subfolder of another repository), so the history and old-commit checks did not run\nWhat to do: Run the tool on the repository's top folder",
  "no remote": "The tool could not look at part of the history\nWhat to do: Informational; the check for that part did not run",
  "remote not checked": "The hidden pull-request ref check did not run: `--offline` was given, or git could not reach the remote without a prompt. The tool never asks for a password, so a private HTTPS remote that needs credentials will often land here\nWhat to do: Run the tool from a shell where git already has credentials for that remote (without `--offline`). If the repository was ever pushed with sensitive content, treat it as needing a fresh repository",
  "user profile path": "A file holds an absolute path into a user profile folder\nWhat to do: Replace it with a relative path or a placeholder",
  "missing LICENSE": "A basics file is absent\nWhat to do: Add one",
  "missing SECURITY": "A basics file is absent\nWhat to do: Add one",
  "missing CI": "A basics file is absent\nWhat to do: Add one",
  "funding file active": "A funding file is switched on\nWhat to do: Make sure that is what you want before going public",
  "checks skipped: no private list": "The personal and restricted checks had nothing to use\nWhat to do: Create and fill in your list",
  "private list has no entries": "The personal and restricted checks had nothing to use\nWhat to do: Create and fill in your list",
  "file skipped": "A file was too large, binary, a symlink or unreadable, so it was not read\nWhat to do: Look at it yourself if it matters",
  "more files skipped": "A file was too large, binary, a symlink or unreadable, so it was not read\nWhat to do: Look at it yourself if it matters",
  "submodule not scanned": "The repository has submodules (another repository each). Their files and history are not part of this scan\nWhat to do: Run the tool inside each submodule before you publish",
  "nested repository not scanned": "An untracked folder inside the repository is itself a git repository. Its files and history are not part of this scan, and a plain `git add` would not publish them\nWhat to do: Scan it on its own, or keep it out of the folder you publish",
  "agent folder in package": "`--pack`: the tarball would contain an assistant folder, a `settings.local.json`, a session file or an instruction file\nWhat to do: Keep it out with a `files` list in `package.json` or an `.npmignore`, then pack again",
  "agent file in package": "`--pack`: the tarball would contain an assistant folder, a `settings.local.json`, a session file or an instruction file\nWhat to do: Keep it out with a `files` list in `package.json` or an `.npmignore`, then pack again",
  "env file in package": "`--pack`: the tarball would contain an `.env*` file, an `.npmrc` or a `.git` folder (contents are never read)\nWhat to do: Exclude it as above; treat anything secret in it as exposed",
  ".npmrc in package": "`--pack`: the tarball would contain an `.env*` file, an `.npmrc` or a `.git` folder (contents are never read)\nWhat to do: Exclude it as above; treat anything secret in it as exposed",
  "git data in package": "`--pack`: the tarball would contain an `.env*` file, an `.npmrc` or a `.git` folder (contents are never read)\nWhat to do: Exclude it as above; treat anything secret in it as exposed",
  "private key file in package": "`--pack`: a key bundle or a `.pem`/`.key` file would ship\nWhat to do: Remove a private key and replace it; check that a certificate is meant to be public",
  "key or certificate file in package": "`--pack`: a key bundle or a `.pem`/`.key` file would ship\nWhat to do: Remove a private key and replace it; check that a certificate is meant to be public",
  "source map with sources": "`--pack`: a `.map` file would ship with your source text inside, or is not valid JSON\nWhat to do: Turn off `sourcesContent` or do not publish maps",
  "source map in package": "`--pack`: a `.map` file would ship with your source text inside, or is not valid JSON\nWhat to do: Turn off `sourcesContent` or do not publish maps",
  "no files list in package": "`--pack`: `package.json` has no `files` list and the source folder has no `.npmignore`\nWhat to do: Add a `files` list so only what you name ships",
  "install script in package": "`--pack`: an `install`, `preinstall` or `postinstall` script runs on every consumer's machine\nWhat to do: Check that you mean it",
  "unsafe path in package": "`--pack`: the tarball held a link (not created) or a name that could leave the folder (not written)\nWhat to do: Look at how the package is built",
  "link in package": "`--pack`: the tarball held a link (not created) or a name that could leave the folder (not written)\nWhat to do: Look at how the package is built",
  "packed without running scripts": "`--pack` notes: scripts did not run, git history is not in a package, and how many files and bytes would ship\nWhat to do: Informational",
  "package contents": "`--pack` notes: scripts did not run, git history is not in a package, and how many files and bytes would ship\nWhat to do: Informational",
  "history not part of a package": "`--pack` notes: scripts did not run, git history is not in a package, and how many files and bytes would ship\nWhat to do: Informational",
};

/** The explanation for a label, or null when the text is not a known label. */
export function explainLabel(label: string): string | null {
  return Object.prototype.hasOwnProperty.call(EXPLAIN, label) ? EXPLAIN[label as Label] : null;
}

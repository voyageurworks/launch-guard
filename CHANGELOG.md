# Changelog

## 0.1.1 - 2026-11-02

No change to the scanner. Releases now go through a two-job workflow with an approval step and are published from GitHub Actions with a provenance statement (npm trusted publishing); more search keywords in `package.json`.

## 0.1.0 - 2026-11-01

First version. Published to npm as `@voyageurworks/launch-guard` (published by hand, so this first version has no provenance badge); it can also be used by copying the `skill/` folder.

- Scans a private git repository before it goes public and reports where problems are, never what they are: file and line, the kind of problem, and which entry of your private list matched. It does not print a secret, any part of one, a value from your list, an author, a commit message or a branch name.
- Four checks: secrets in files (known key formats and private key blocks), personal details and restricted terms from your own private list (in file contents, file names, and the whole git history including commit messages, authors and reflog), old commits that may still be reachable after a history rewrite, and repository basics (licence, security policy, CI, and similar).
- Works as a Claude Code / Codex skill (the `skill/` folder with one dependency-free script) or from the command line: `node skill/launch-guard.mjs <repo>`.
- `--offline` skips the only network step, a read-only `git ls-remote` against your configured remotes. `--init-list` writes a template for the private list; nothing else is ever written.
- Exit codes: 0 for no blocking findings, 1 when anything blocks publishing, 2 when the tool itself could not run.
- Every git call is bounded by a timeout. A git that does not answer ends in a visible "history incomplete" or "not a repository root" note, not a silent pass and not a hang.
- The history check also reads what a merge commit changed beyond an automatic merge (git 2.36+), and the messages and taggers of annotated tags.
- The secret rule follows a value that sits on a later line than its key (a YAML block, a continuation, a string split with `+`, up to four lines), reads quoted values with symbols, knows more provider token formats and `Authorization: Bearer` headers. A repository with submodules or an untracked nested repository gets an info note that they were not scanned.
- The remote check uses your own ssh setting (`GIT_SSH_COMMAND`, global or system `core.sshCommand`, `GIT_SSH`) instead of replacing it, adding batch mode (first, so it cannot be undone) to a plain `ssh`. The scanned repository's own `core.sshCommand` and `core.fsmonitor` are never run, so scanning someone else's clone cannot execute their program.
- The history scan pins the diff options it depends on, so a user's `log.showRoot`, `diff.suppressBlankEmpty` or `diff.context` cannot hide or misplace a finding.
- Every keyword and format pattern is linear-time on hostile input (a 1 MB single line takes under a second); two older patterns that were quadratic were fixed.
- `--json` prints the report as one JSON document with the same six fixed fields per finding (and the same exit code), for scripts and CI. `--print-hook` prints a git pre-push hook to the screen; the tool still writes nothing inside a repository. `docs/ci.md` has a ready GitHub Actions job.
- Unreachable objects are reported as one line with a count.
- A leak test suite checks that the secrets, list values, names and paths planted in test repositories never appear in any output or error.

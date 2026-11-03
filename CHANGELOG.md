# Changelog

## 0.2.2 - 2026-11-03

No change to the tool. The GitHub repository is now `voyageurworks/launch-guard-pack` (GitHub redirects the old address), so the package and the repository share one name; the package links, the CI badge and the release workflow's repository check use the new name. macOS tests moved out of the push CI into a separate workflow that is not a required check and runs on every pull request, weekly and on demand, because GitHub often never assigns a macOS runner and a job that never starts marked every push to main as failed. macOS is therefore still attempted on every change, but it is **not guaranteed to have run**: macOS on Node 22 has still not been run for 0.2.x. The release steps now require a manual macOS run on the release commit with the result, or the gap, written in the release notes. The macOS state is tracked in an open issue.

## 0.2.1 - 2026-11-03

No change to the tool. This is the first version published by GitHub Actions through npm trusted publishing, which also gives it a provenance statement; 0.2.0 was published by hand. The macOS test note under 0.2.0 still applies: macOS on Node 22 has not been run for 0.2.x.

## 0.2.0 - 2026-11-03

**The package is now `@voyageurworks/launch-guard-pack`.** The command is still `launch-guard`, so scripts, hooks and the skill keep working; only the install name changes (`npx -y @voyageurworks/launch-guard-pack <repo>`). The earlier `@voyageurworks/launch-guard` (0.1.0 to 0.1.3) is deprecated in favour of it. The GitHub repository keeps its name.

**Test coverage for this release.** CI passed on ubuntu and Windows with Node 22 and 24, and on macOS with Node 24 (on the code just before the package rename). The macOS Node 22 job never got a runner from GitHub: it was cancelled after 15 minutes with no runner assigned, twice, and the macOS jobs for the final renamed code were still queued when the release was decided. The maintainer accepted releasing without those macOS results. The rename changed only package metadata, documentation and one workflow line, none of it macOS-specific, but macOS Node 22 has not been run for this version.

A new mode, `--pack`, and a few shared improvements. Nothing changes unless you use a new flag, except that the secret scanner now also recognises the credential forms listed below.

- **`--pack`**: scans what `npm pack` would ship instead of the repository. It builds the tarball into a temporary folder with `--ignore-scripts` (nothing is published, no lifecycle script runs), unpacks it with a built-in reader (no links created, no path leaves the folder, size and file-count caps), runs the secret scanner and the private list on every file that would ship (including `dist/` and bundled `node_modules/`), applies package rules, and deletes the temporary folders. The report keeps the same text and JSON shapes and exit codes, and still shows only paths inside the package, fixed labels and numbers, never matched text.
- **No project script ever runs.** npm 10 (bundled with Node 22) still runs `prepare` during `npm pack --ignore-scripts`; found by the Node 22 CI jobs. A project that defines any pack-time script (`prepack`, `prepare`, `postpack`, `prepublish`, `prepublishOnly`, `publish`, `postpublish`) is now packed from a temporary copy with those scripts removed; the project's own files are never changed.
- Package rules: blocks assistant folders (`.claude`, `.codex`, `.cursor`, `.gemini`, `.windsurf`) and `settings.local.json`, session and transcript files, `.env*` files, `.npmrc`, `.git` data and private key files; warns about instruction files, `.pem`/`.key` files without a private key block, source maps that embed source text, a missing `files` list, and install-time scripts.
- New labels, all under the new category `package`; the six fields per finding and `version: 1` of the JSON report are unchanged. `--pack` combines with a path, `--list`, `--json` and `--offline` (accepted, nothing to skip); not with `--init-list` or `--print-hook`. A package that cannot be built or read exits 2 with one fixed message.
- **`--fail-on <block|warn>`**: `warn` makes warnings fail the run as well (exit 1, `RESULT: FAIL`, `"result": "fail"`). The default stays `block`, so nothing changes unless you ask. Works with every scan mode, including `--pack`.
- **`--explain <label>`**: prints what a report label means and what to do about it. The text is generated from the README table and a test keeps the two identical. It is a mode of its own (not combined with other flags) and prints only that fixed text.
- **More secret detectors (repo scan and `--pack` alike)**: `.npmrc` credentials (`_authToken`, `_auth`, `_password` with a literal value; `${NPM_TOKEN}` and placeholders are fine), Docker `config.json` `auth` entries that decode to `user:password`, connection strings with a literal `Password=` next to a `Server=`/`Host=`/`Database=` field (even a short password), and the token formats of PyPI, Docker Hub, Databricks, Linear, Grafana service accounts, Postman and NuGet.
- Internal: `listRepoFiles` can walk `.git`, `node_modules` and `dist` for an unpacked package; the user-profile-path check is available without the git-based repository checks.

## 0.1.3 - 2026-11-02

No change to the scanner. The README now starts with the one command (`npx -y @voyageurworks/launch-guard <repo>`), a real example of its output on a repository with a fake key, a 30-second demo you can run, and an honest comparison with gitleaks and TruffleHog (sourced from their READMEs). The skill install steps moved below it.

## 0.1.2 - 2026-11-02

Version 0.1.1 was tagged but never published to npm (its release job failed before the publish step), so 0.1.2 is the first version published from GitHub Actions.

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

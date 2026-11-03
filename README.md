<img src=".github/brand/icon.png" align="right" width="112" alt="launch-guard icon">

# launch-guard

[![npm](https://img.shields.io/npm/v/@voyageurworks/launch-guard-pack.svg)](https://www.npmjs.com/package/@voyageurworks/launch-guard-pack)
[![CI](https://github.com/voyageurworks/launch-guard-pack/actions/workflows/ci.yml/badge.svg)](https://github.com/voyageurworks/launch-guard-pack/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**Check a private git repository before you make it public, and never print what it finds.**

```sh
npx -y @voyageurworks/launch-guard-pack path/to/your/repo
```

You need Node 22 or newer and nothing else. It never edits the repository, and the only network step (a read-only `git ls-remote`) can be switched off with `--offline`. The exit code is `0` when nothing blocks publishing, `1` when something does.

## What it looks like

Real output on a throwaway repository whose `app.js` holds a fake AWS-style key:

```text
BLOCK (2)
  app.js:1 secret format
  4e4cc92:app.js:1 secret in history

WARN (4)
  list private list has no entries
  LICENSE missing LICENSE
  SECURITY missing SECURITY
  CI missing CI

INFO (1)
  remote no remote
RESULT: FAIL
```

It says which file and line, what kind of problem, and that an old commit holds the same thing (deleting the line is not enough once a repository is public). It does not print the key, any part of it, or the commit message.

Try the same thing in 30 seconds, with no real secret (bash, macOS, Linux or Git Bash; your commit id will differ):

```sh
mkdir launch-guard-demo && cd launch-guard-demo && git init -q
printf "const k = 'AKIA%s';\n" ABCDEFGHIJKLMNOP > app.js
git add . && git -c user.name=demo -c user.email=demo commit -qm demo
npx -y @voyageurworks/launch-guard-pack . --offline
```

By [Voyageur Works](https://github.com/voyageurworks). MIT licence.

## Why

More and more repositories are written with an AI assistant, and the assistant is also the one you ask "is this safe to publish?" The trouble is that a normal scanner prints what it finds. If an AI runs it, your secret key or your home address is now in the chat.

launch-guard is built so that cannot happen. It only reports **where** something is (file and line), **what kind** of problem it is, and which entry of your private list matched. It does not print the secret, any part of it, a value from your list, an author name or a commit message. It never changes your files, rewrites history or pushes. The only network use is a read-only `git ls-remote` against your configured remotes (skip it with `--offline`), and the only file it writes is the template from `--init-list`.

## Next to gitleaks and TruffleHog

launch-guard does not replace a general secret scanner; run those too. They are built for other jobs. Everything in the right-hand column comes from their own READMEs (checked 2026-11-02).

| | launch-guard | [gitleaks](https://github.com/gitleaks/gitleaks), [TruffleHog](https://github.com/trufflesecurity/trufflehog) |
| --- | --- | --- |
| Main question | "Is this repository safe to make public?" | "Where are the secrets in this code, history or data source?" |
| What a finding shows | File and line, kind of problem, which list entry matched. Never the value, an author or a commit message. | gitleaks' documented `git -v` output shows the matched secret, the author, the email and the commit. |
| Your own private words (names, address, school, codewords) | Checked from a private list that stays outside the repository | Not their purpose (gitleaks can be given custom rules) |
| Where it looks | One git repository: files, history, tags, reflog, leftover refs | gitleaks: git repositories, directories and stdin. TruffleHog also scans chats, wikis, object stores and more |
| Secret formats | A focused set of known formats plus assignments next to words like key or token | TruffleHog classifies 800+ secret types and can check whether a credential is still live |
| Built to be run by an AI assistant | Yes: the output is safe to appear in a chat | Not what they are designed around |

Use gitleaks or TruffleHog for continuous scanning and to check live credentials. Use launch-guard as the last check before you press "make public", and whenever an AI assistant is the one running it.

## Use it as a Claude Code or Codex skill

## First run, no setup

```
npx -y @voyageurworks/launch-guard-pack <repo>
```

(From a clone, `node skill/launch-guard.mjs <repo>` does the same.) Replace `<repo>` with the path of the repository (leave it out to scan the current folder). Add `--offline` to skip the one network step (see "Network and files" below). Point it at the top folder of a repository: for a plain folder or a subfolder of a repository it skips the history and old-commit checks and says so. With no private list yet, it still checks for secrets, old commits that stay reachable, and the basics, and says plainly that the personal and restricted checks were skipped.

## In scripts, before a push, and in CI

- `--json` prints the same report as one JSON document (`version`, `result`, `counts`, `findings`), with the same six fixed fields per finding and the same promise: no secret, no list value, no commit message. The exit code is the same, so `node skill/launch-guard.mjs . --json --offline > report.json` works in any script.
- `--print-hook` prints a git `pre-push` hook to the screen. It writes nothing; you save it yourself as `.git/hooks/pre-push` (the tool never edits a repository) and put the path of `launch-guard.mjs` into it. Any blocking finding then stops the push.
- `--fail-on warn` makes warnings fail the run too (exit code 1, `RESULT: FAIL`, `"result": "fail"` in `--json`). The default is `--fail-on block`. Expect a few warnings on most repositories (a missing SECURITY file, an extra ref), so use it where you want a strict gate.
- `--explain <label>` prints what a report label means and what to do about it, for example `--explain "secret format"`. The text is the same as the table in "Reading the report" (a test fails if the two differ). An unknown label lists the known ones.
- `--pack` scans the package `npm publish` would upload instead of the repository (see the section below). Run it as the step before `npm publish`.
- [docs/ci.md](docs/ci.md) has a ready GitHub Actions job. A runner has no private list, so CI covers secrets, history, old commits and basics; the personal and restricted checks stay on your own machine.

## Check what `npm publish` would ship: `--pack`

A clean repository can still publish a leaky package, because what `npm publish` uploads is decided by `files`, `.npmignore` and `.gitignore`, not by what you committed. Assistant settings, `.env` files and source maps are easy to include by accident. `--pack` checks the package, not the repository:

```
npx -y @voyageurworks/launch-guard-pack . --pack --offline
```

It runs `npm pack --ignore-scripts` into a fresh temporary folder (if your `package.json` defines `prepack`, `prepare`, `postpack`, `prepublish`, `prepublishOnly`, `publish` or `postpublish`, it packs a copy of the project with those scripts removed instead, because npm 10, the npm that ships with Node 22, still runs `prepare` during `npm pack --ignore-scripts`; your own files are never changed), unpacks the tarball there with a small built-in reader (no links are created, no name may leave the folder, and the size and file count are capped), runs the secret scanner and your private list on **every file that would ship** (including `dist/` and bundled `node_modules/`), applies the package rules below, and deletes both temporary folders. Nothing is published, no lifecycle script runs, nothing is sent anywhere. The report is the same shape as before (text or `--json`, same exit codes) and the same promise holds: where and what kind, never the matched text. Paths are shown as they are inside the package.

A real run on a throwaway package (the key is fake) that has a `.claude` folder, a built file with a key and a source map:

```
BLOCK (2)
  dist/index.js:1 secret format
  .claude/settings.local.json agent folder in package

WARN (2)
  dist/index.js.map source map with sources
  package.json no files list in package

INFO (4)
  list checks skipped: no private list
  npm pack packed without running scripts
  history history not part of a package
  5 files, 230 B unpacked package contents
RESULT: FAIL
```

| Package rule | Level |
| --- | --- |
| A file under `.claude/`, `.codex/`, `.cursor/`, `.gemini/` or `.windsurf/`, or any `settings.local.json` | block |
| A session or transcript file (`*session*`, `*transcript*` with `.md`, `.json` or `.jsonl`) | block |
| An `.env*` file (not `.env.example`, `.env.sample`, `.env.template`), an `.npmrc`, anything under `.git/` | block |
| A private SSH key by name (`id_rsa`, `id_ed25519` and so on, not `.pub`), a `.p12`/`.pfx` file, or a `.pem`/`.key` file that holds a private key block | block |
| A `.pem`/`.key` file with no private key block | warn |
| A source map whose `sourcesContent` holds source text, or a `.map` file that is not valid JSON | warn |
| `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, `.cursorrules` or a `memory/` folder | warn |
| `package.json` has no `files` list and the folder has no `.npmignore`, so npm used its default rules | warn |
| An `install`, `preinstall` or `postinstall` script (it runs on the machine of everyone who installs the package) | warn |
| Symbolic links, hard links, and names that could climb out of the folder | info / warn |

Session files and instruction files inside a bundled `node_modules/` are not flagged (they belong to someone else's package); everything else, including secrets, applies there too. The test-folder rule from "Reading the report" still applies to what ships: a secret under a shipped `test/` or `fixtures/` folder only warns, so look at warnings there.

What it does not do:

- **npm only.** It calls `npm pack`. pnpm and yarn workspaces are not treated specially, and a monorepo needs the path of each package.
- **Scripts do not run.** If the files you publish are made by a `prepack` or `build` step, run that step first, or `dist/` will be missing and the report will not describe what you really ship. When scripts are removed from the packed copy, a `.git` folder, any `node_modules` folder (the top-level one is linked back so bundled dependencies still ship) and symbolic links are left out of that copy, which npm would leave out of the package as well.
- **No comparison with the version on npm**, no network, and no check of what is already published.
- **It checks names and structure plus the same line scanners.** A secret with no key word beside it is still invisible; files over 1 MiB are not read by the secret scanner (a "file skipped" note says so), though source maps are parsed up to 64 MiB.

Next to the tools built for packages: [publint](https://github.com/publint/publint) describes itself as "Lint packaging errors. Ensure compatibility across environments." and [secretlint](https://github.com/secretlint/secretlint) as "a Pluggable linting tool to prevent committing credentials" (both from their own READMEs, checked 2026-11-03). Neither is a replacement for this and this is not a replacement for either. `--pack` is one more check inside launch-guard, and what it adds is the same promise as the rest of the tool: output that is safe to show an AI assistant, rules for assistant folders, and your private list applied to the package.

## Your private list

To catch your own names, address, school, family or codewords, the tool needs a list of them. The list lives outside the repo so it can never be published by accident.

```
node skill/launch-guard.mjs --init-list
```

This creates a template at `~/.config/launch-guard/private-list.txt`. It will not overwrite a file and will not write inside a git repository. Open it in **your own editor** and add one entry per line, in the format `kind|regex`:

```
personal|zq-example-name
restricted|zq-example-codeword
```

`kind` is `personal` or `restricted`. The part after `|` is a regular expression, matched without regard to upper or lower case. Lines starting with `#` and blank lines are ignored. To use a list in another place, add `--list <file>`.

**Never paste the list into a chat, and never ask an assistant to open it.** The assistant does not need the values. The report will say "list entry 3", and you can look up line 3 yourself.

## The four checks

1. **Secrets.** Known key formats and long random-looking strings next to words like key, token or password, in your current files. It follows a value that sits on a later line than its key (a YAML block, a continuation, or a string split with `+` or a backslash, over up to four lines), reads quoted values that contain symbols, and knows the formats of common providers (cloud, payment, chat and developer tokens) as well as `Authorization: Bearer` headers. It also reads credential lines that carry no key word: `.npmrc` `_authToken`, `_auth` and `_password` values (an `${NPM_TOKEN}` reference is fine), a Docker `config.json` `"auth"` that decodes to `user:password`, and a `Password=` inside a connection string next to `Server=`, `Host=` or `Database=`.
2. **Personal details and restricted terms.** Everything in your private list, matched against file contents and against file and folder names.
3. **History.** Every branch, tag and the reflog, checked for the same secrets and list entries in old versions of files, in commit messages, in annotated tag messages and taggers, in author names and emails, and in what a merge commit changed beyond an automatic merge (such as a secret typed in while resolving a conflict). The merge check needs git 2.36 or newer; on an older git it says "history incomplete".
4. **Old commits still reachable.** Leftover rewrite refs, extra refs and hidden pull-request refs on your remotes that would still be downloadable after a history rewrite, plus local unreachable objects (a prompt to check, not proof of a leak).

It also runs a few basics: the presence of a LICENSE, a SECURITY file and CI, a funding file that is switched on, and absolute paths to a user profile folder (such as `C:\Users\<name>`) in assistant files like `CLAUDE.md`.

## Reading the report

Each line looks like `path:line label (list entry N)`, grouped by level. The last line is `RESULT: PASS` or `RESULT: FAIL` (with `--json`, the `result` field says `pass` or `fail` instead).

| Label | What it means | What to do |
| --- | --- | --- |
| secret format | A string shaped like a known key or token | Remove it from the file, then treat the key as exposed and replace it at its provider |
| secret near keyword | A long random-looking value next to a word like key, token or password | Check the line yourself; remove it, or mark it allowed if it is harmless (see below) |
| tracked env file | A `.env` file is tracked by git (its contents are never read) | Stop tracking it and keep it out of the repo; replace any secrets in it |
| personal detail | A `personal` entry from your list matches in a file | Edit the line yourself |
| restricted term | A `restricted` entry from your list matches in a file | Edit the line yourself |
| path matches list | A file or folder name matches your list (shown as `[redacted]`) | Rename it |
| list inside repo | Your private list is inside the folder being scanned | Move it out of the repo |
| secret in history | A secret appears in an old version of a file | See the note on history below |
| term in history | A list entry appears in an old commit, message, author or ref name | See the note on history below |
| recommend a fresh repository | A rewrite leftover (`refs/original`) or a hidden pull-request ref on a remote would stay reachable | Publish from a brand-new repository with no old history |
| unreachable object | Git still holds an object that no branch reaches. Staging, amending, rebasing and `git stash drop` all leave these until git cleans up. They are local and a push does not publish them | A warn, not proof of a leak: check that nothing sensitive was in the file you changed. To clear them, run `git reflog expire --expire-unreachable=now --all`, then `git gc --prune=now` (`git gc --prune=now` alone only clears re-staged blobs and dropped stash entries, because the reflog still holds commits left by an amend or rebase) |
| extra ref | A branch, tag or stash beyond the current branch | Check whether it should be public |
| not a repository root | The folder is not the top level of a git repository (a plain folder, or a subfolder of another repository), so the history and old-commit checks did not run | Run the tool on the repository's top folder |
| user profile path | A file holds an absolute path into a user profile folder | Replace it with a relative path or a placeholder |
| missing LICENSE, missing SECURITY, missing CI | A basics file is absent | Add one |
| funding file active | A funding file is switched on | Make sure that is what you want before going public |
| file skipped, more files skipped | A file was too large, binary, a symlink or unreadable, so it was not read | Look at it yourself if it matters |
| history incomplete, no commits, no remote | The tool could not look at part of the history | Informational; the check for that part did not run |
| nested repository not scanned | An untracked folder inside the repository is itself a git repository. Its files and history are not part of this scan, and a plain `git add` would not publish them | Scan it on its own, or keep it out of the folder you publish |
| submodule not scanned | The repository has submodules (another repository each). Their files and history are not part of this scan | Run the tool inside each submodule before you publish |
| remote not checked | The hidden pull-request ref check did not run: `--offline` was given, or git could not reach the remote without a prompt. The tool never asks for a password, so a private HTTPS remote that needs credentials will often land here | Run the tool from a shell where git already has credentials for that remote (without `--offline`). If the repository was ever pushed with sensitive content, treat it as needing a fresh repository |
| agent folder in package, agent file in package | `--pack`: the tarball would contain an assistant folder, a `settings.local.json`, a session file or an instruction file | Keep it out with a `files` list in `package.json` or an `.npmignore`, then pack again |
| env file in package, .npmrc in package, git data in package | `--pack`: the tarball would contain an `.env*` file, an `.npmrc` or a `.git` folder (contents are never read) | Exclude it as above; treat anything secret in it as exposed |
| private key file in package, key or certificate file in package | `--pack`: a key bundle or a `.pem`/`.key` file would ship | Remove a private key and replace it; check that a certificate is meant to be public |
| source map with sources, source map in package | `--pack`: a `.map` file would ship with your source text inside, or is not valid JSON | Turn off `sourcesContent` or do not publish maps |
| no files list in package | `--pack`: `package.json` has no `files` list and the source folder has no `.npmignore` | Add a `files` list so only what you name ships |
| install script in package | `--pack`: an `install`, `preinstall` or `postinstall` script runs on every consumer's machine | Check that you mean it |
| link in package, unsafe path in package | `--pack`: the tarball held a link (not created) or a name that could leave the folder (not written) | Look at how the package is built |
| packed without running scripts, history not part of a package, package contents | `--pack` notes: scripts did not run, git history is not in a package, and how many files and bytes would ship | Informational |
| checks skipped: no private list, private list has no entries | The personal and restricted checks had nothing to use | Create and fill in your list |

For a harmless match (a test file, a documented example) put `launch-guard-allow: <reason>` in a comment on that line or the line above, with a real reason. Only secret findings and the user-profile-path finding are lowered from block to warn, and only in test files (`*.test.*`, `*.spec.*`, `*_test.*`, `test_*`) and under `test`, `tests`, `spec`, `specs`, `fixtures`, `__tests__`, `__fixtures__`, `__mocks__`, `testdata` and `docs/examples` folders. Findings from your private list (personal, restricted, matching paths, history) always stay block there: those are things you said must not be public, so use `launch-guard-allow: <reason>` for a real exception. Files with a key or credential extension (`pem key p12 pfx env crt cer jks keystore asc gpg ppk kdbx`) and names starting `.env` are never lowered, whatever their folder or name.

### Levels and exit codes

- **block**: must be fixed. Any block makes the result FAIL.
- **warn**: look at it.
- **info**: a note, such as a skipped file or a missing list.

Exit code `0` means no blocking findings, `1` means at least one blocking finding, and `2` means the tool could not run (a bad path, a bad list, or an internal error, which prints one fixed message and nothing else).

`PASS` is not a promise that the repository is safe. It means these checks found nothing that blocks.

## Network and files

- The only network use is a read-only `git ls-remote --refs` against each remote you have configured, to look for hidden pull-request refs. It never prompts for credentials, and it uses your own ssh setting (`GIT_SSH_COMMAND`, `core.sshCommand` or `GIT_SSH`) the way git would; for a plain `ssh` it only adds batch mode so nothing waits for a password. Skip it with `--offline`, which adds an info note that the remote was not checked (or, when no remote is configured, a "no remote" note instead).
- The only file the tool writes is the template from `--init-list`, and only if nothing is there yet and the location is outside any git repository.
- It sends nothing anywhere else and has no telemetry.

## Stop your assistant reading the list

The skill tells the assistant never to open your list, but a skill is only advice. To enforce it in Claude Code, add a deny rule for the list's path to your user settings (`~/.claude/settings.json`). It has this shape:

```json
{
  "permissions": {
    "deny": ["Read(~/.config/launch-guard/private-list.txt)"]
  }
}
```

This follows Claude Code's documented permission rule form `Read(path)`, where `~/` means your home folder. Settings change over time, so check the current [permissions documentation](https://code.claude.com/docs/en/permissions) before relying on it.

Tested 2026-10-31 on Claude Code 2.1.316: with the permission mode set to `bypassPermissions`, a headless session was still refused when it asked the Read tool for a file named in such a rule, while a control file in the same folder read fine. So the rule holds in that mode too; re-check it after Claude Code updates.

What this does and does not do: it blocks the assistant's built-in file-reading tool, and Claude Code also applies Read rules to common shell commands that name the file. It does not reliably stop every command the assistant could run in a shell (for example one that searches a whole folder without naming the file). For stronger protection, also cover the path with Claude Code's sandbox read restrictions, or keep the list somewhere the assistant's session cannot reach. See the same documentation.

Codex has its own permission and sandbox settings, and they should be set so that the assistant cannot read the list's location. Use Codex's own documentation for the exact settings; they are not repeated here.

## Honest limits

- **macOS is not tested on every change.** CI runs on Linux and Windows (Node 22 and 24). macOS has its own workflow, which runs on every pull request, weekly and on demand, but GitHub often never assigns a macOS runner, so those runs are often cancelled. macOS on Node 22 has not been run for 0.2.x. The state is tracked in an open issue; the weekly workflow records it when a runner is available.
- **A chat already holds everything typed or read in it.** If you paste a secret or your list into a conversation, no tool can take it back out.
- **Fixing a leak means someone sees the line.** The report tells you where. You or your assistant still has to open that spot to change it.
- **The existence of a category is disclosed.** "A personal detail was found in this file" is itself information, even though the detail is not shown.
- **A scanner that matches patterns cannot see everything.** A secret with no key word beside it and no known provider format (for example a bare random string in a variable named `x`), one split over more than four lines or inside a Python parenthesised string, a triple-quoted block, a heredoc or a template literal, one that is encoded or encrypted, or one inside a binary or very large file is not found. `PASS` means these rules found nothing, not that nothing is there. Rotate any key that was ever committed.
- **GitHub's own caches cannot be seen.** If the repository was ever pushed with something sensitive, copies may live in places this tool cannot check (forks, pull-request refs, cached views). The safe answer is a fresh repository with no history, and the tool says so rather than claiming a rewrite is enough.
- **Amending, rebasing, staging and stashing leave old objects behind.** They are no longer on any branch but stay in the repository until git cleans up (first `git reflog expire --expire-unreachable=now --all`, then `git gc --prune=now`; the reflog keeps amended and rebased commits alive). They are local and a push does not publish them, so they only warn.
- **`--pack` inspects what `npm pack --ignore-scripts` produces**, not what a build would produce, and it needs npm on your PATH (exit code 2 and one fixed message if the package cannot be built or read). See the `--pack` section for the rest.
- **Example env files are read.** `.env.example`, `.env.sample` and `.env.template` are scanned for secrets like any other file; other `.env` files are flagged by name and never opened.
- **It is not a replacement for a general secret scanner**, and it gives no legal or licence advice.

## Contributing and security

Issues and pull requests are welcome; please read the [code of conduct](CODE_OF_CONDUCT.md). Keep test data obviously fake (words like `zq-example`), and never include anything real. Run `pnpm check`, `pnpm test` and `pnpm build` before sending a change, and commit the rebuilt `skill/launch-guard.mjs` with it.

To report a vulnerability, including any case where the tool prints something private, see [SECURITY.md](SECURITY.md).

## Licence

MIT. See [LICENSE](LICENSE).
